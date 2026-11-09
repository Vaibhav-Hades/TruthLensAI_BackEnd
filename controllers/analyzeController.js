const { runPhase1Pipeline } = require('../services/pipelineService')
const { runPhase2Intelligence, getFallbackIntelligence } = require('../services/intelligenceService')
const { analyzeLiveNarrative } = require('../services/eventRegistryService')
const { runSemanticVerification } = require('../services/semanticService')
const { generateCredibilityReport } = require('../services/credibilityService')
const { findReferenceMatches } = require('../services/referenceDatasetService')
const { logAnalysis } = require('../services/analysisLogService')
const { validateAnalyzeInput } = require('../utils/inputValidation')
const logger = require('../utils/pipelineLogger')

/**
 * analyzeController.js — master orchestrator for POST /api/analyze
 *
 * 1. Validate input            4. Semantic audit (aggregate per-claim stances)
 * 2. Extract content (Phase 1) 5. Reference-dataset context (similarity = context only)
 * 3. Intelligence + evidence   6. Evidence-based classification (REAL/FAKE/MISLEADING/INCONCLUSIVE)
 *
 * Response keeps every field the existing UI reads and adds:
 *   prediction, confidence, explanation, matched_text
 */

function stageLog(stage, msg, data) {
  logger.emit('INFO', `analyze:${stage}`, msg, data ? { data: typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data) } : {})
}

const EXTRACTION_ERROR_STATUS = {
  INVALID_URL: 400, UNSUPPORTED_CONTENT: 422, ARTICLE_FETCH_FAILED: 422, CONTENT_TOO_SHORT: 422,
  TRANSCRIPT_UNAVAILABLE: 422, VIDEO_RESTRICTED: 422, VIDEO_TOO_LONG: 422, VIDEO_UNAVAILABLE: 422,
  CONTENT_EXTRACTION_FAILED: 422, YTDLP_MISSING: 503, FFMPEG_MISSING: 503, WHISPER_NOT_CONFIGURED: 503,
  AUDIO_DOWNLOAD_FAILED: 502,
}

const SUGGESTIONS = {
  UNSUPPORTED_CONTENT: 'Paste the text of the content instead, or use a YouTube or news-article link.',
  ARTICLE_FETCH_FAILED: 'Open the article, copy its text, and paste it into the text box.',
  CONTENT_TOO_SHORT: 'Provide a longer piece of text or a different link.',
  TRANSCRIPT_UNAVAILABLE: 'Try another video, or paste the transcript as text.',
  VIDEO_RESTRICTED: 'Try a public video, or paste the transcript as text.',
  VIDEO_TOO_LONG: 'Try a shorter video (30 minutes or less), or paste the transcript as text.',
  INVALID_URL: 'Check the link and try again.',
}

function buildMatchedText({ liveNarrative, claimVerifications, referenceMatches }) {
  const out = []
  const seen = new Set()
  for (const cv of claimVerifications || []) {
    for (const a of cv.citedArticles || []) {
      if (a.url && !seen.has(a.url)) {
        seen.add(a.url)
        out.push({ origin: 'event_registry', stance: cv.verdict === 'SUPPORTED' ? 'supports' : cv.verdict === 'REFUTED' ? 'contradicts' : 'neutral',
          claim: cv.claim, title: a.title, source: a.source, url: a.url, text: (cv.evidence || [])[0] || cv.reasoning })
      }
    }
  }
  for (const a of liveNarrative.articleSummaries || []) {
    if (a.url && !seen.has(a.url) && out.length < 8) {
      seen.add(a.url)
      out.push({ origin: 'event_registry', stance: a.stance === 'support' ? 'supports' : a.stance === 'refute' ? 'contradicts' : 'neutral',
        title: a.title, source: a.source, url: a.url, text: a.aiSummary || (a.body || '').slice(0, 280), relevanceScore: a.relevanceScore })
    }
  }
  for (const r of referenceMatches || []) {
    out.push({ origin: 'reference_dataset', stance: 'context', label: r.label, similarity: r.similarity, title: r.title, text: r.snippet })
  }
  return out
}

async function analyzeVideo(req, res) {
  const startTimeTotal = Date.now()
  const stageTimings = {}

  try {
    // ── STEP 0: VALIDATION ──
    const { input, kind } = validateAnalyzeInput(req.body && req.body.url)
    stageLog('init', 'Starting verification sequence...', { kind, url: kind === 'url' ? input.slice(0, 60) : '[text]' })

    // ── STEP 1: EXTRACTION ──
    let t = Date.now()
    const pipelineResult = await runPhase1Pipeline(input)
    stageTimings.extraction = Date.now() - t
    stageLog('phase1', `Extraction complete. Length: ${pipelineResult.cleanedTranscript.length} chars.`)

    // ── STEP 2: INTELLIGENCE (LLM with deterministic fallback) ──
    t = Date.now()
    let intelligence
    try {
      intelligence = await runPhase2Intelligence(pipelineResult)
    } catch (err) {
      stageLog('phase2', 'Intelligence failed, using fallback', { err: err.message })
      intelligence = getFallbackIntelligence(pipelineResult.cleanedTranscript, pipelineResult.metadata)
    }
    stageTimings.intelligence = Date.now() - t

    // ── STEP 3: EVIDENCE RETRIEVAL (Event Registry) ──
    t = Date.now()
    const liveNarrative = await analyzeLiveNarrative(pipelineResult.cleanedTranscript, intelligence)
    stageTimings.retrieval = Date.now() - t

    // ── STEP 4: SEMANTIC AUDIT (aggregates per-claim stances) ──
    t = Date.now()
    let semanticSignals
    try {
      semanticSignals = await runSemanticVerification(
        intelligence.extractedClaims || intelligence.claims || [],
        liveNarrative.articleSummaries || [],
        intelligence.humanizedSummary || intelligence.summary,
        liveNarrative.claimVerifications || []
      )
    } catch (err) {
      stageLog('semantic', 'Semantic audit failed', { err: err.message })
      semanticSignals = { narrativeAlignment: 50, contradictionLevel: 'none', consensusState: 'Insufficient Coverage', semanticConfidence: 20 }
    }
    stageTimings.semantic_audit = Date.now() - t

    // ── STEP 5: REFERENCE DATASET (context only) ──
    t = Date.now()
    let referenceMatches = []
    try { referenceMatches = findReferenceMatches(pipelineResult.cleanedTranscript.slice(0, 3000)) } catch (err) {
      stageLog('reference', 'Reference lookup failed', { err: err.message })
    }
    stageTimings.reference = Date.now() - t

    // ── STEP 6: CLASSIFICATION + EXPLANATION ──
    t = Date.now()
    const report = await generateCredibilityReport({
      intelligence, liveNarrative, semanticSignals, referenceMatches,
      pipeline: { metadata: pipelineResult.metadata }
    })
    stageTimings.synthesis = Date.now() - t

    const totalTime = Date.now() - startTimeTotal
    stageLog('finalize', `Investigation complete in ${totalTime}ms`, { prediction: report.prediction })

    const matchedSources = (liveNarrative.articleSummaries || []).map(art => ({
      title: art.title, url: art.url, source: art.source, publishDate: art.publishDate, image: art.image,
      aiSummary: art.aiSummary, stance: art.stance, relevanceScore: art.relevanceScore,
      matchedEntities: art.matchedEntities || [], matchedClaims: art.matchedClaims || [],
      evidenceType: art.evidenceType || 'Institutional Report'
    }))

    logAnalysis({
      url: kind === 'url' ? input : '[text input]',
      contentType: pipelineResult.sourceType,
      prediction: report.prediction, truthScore: report.credibilityScore, confidence: report.confidence
    })

    return res.status(200).json({
      // ── New structured result ──
      prediction: report.prediction,                 // REAL | FAKE | MISLEADING | INCONCLUSIVE
      confidence: report.confidence,                 // 0-100, confidence in `prediction`
      explanation: report.reasoning,
      matched_text: buildMatchedText({ liveNarrative, claimVerifications: report.claimVerifications, referenceMatches }),

      // ── Fields consumed by the existing UI ──
      summary: report.summary,
      videoSummary: report.videoSummary || report.summary,
      meaning: intelligence.meaning,
      keyPoints: intelligence.keyPoints || [],
      contextualNarrative: intelligence.contextualNarrative || '',
      keywords: intelligence.keywords || [],
      claims: intelligence.extractedClaims || intelligence.claims || [],
      claimVerifications: report.claimVerifications || [],
      verdict_label: report.verdict,
      verdict: report.verdict,
      truthScore: report.credibilityScore,
      scoreConfidence: report.confidence,
      matchedSources,
      liveNarrativeAnalysis: liveNarrative,
      semanticAnalysis: {
        narrativeAlignment: report.narrativeAlignment,
        contradictionLevel: report.contradictionLevel,
        reasoning: report.reasoning
      },
      classification: report.classification,
      retrievalStatus: liveNarrative.retrievalStatus || 'ok',
      referenceDataset: { matches: referenceMatches.length },
      pipeline: { sourceType: pipelineResult.sourceType, metadata: pipelineResult.metadata },
      extractedEntities: intelligence.extractedEntities || [],
      narrativeTopics: intelligence.narrativeTopics || [],
      retrievalSignals: intelligence.retrievalSignals || {},
      keywordRelevance: intelligence.keywordRelevance || {},
      analysisId: Buffer.from(input.slice(0, 32) + Date.now()).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
      _diagnostics: { timings: stageTimings, totalTime }
    })

  } catch (err) {
    // Known, user-facing failures keep their own status code (not a blanket 500).
    const code = err.errorCode
    const status = err.status || EXTRACTION_ERROR_STATUS[code] || (code ? 422 : 500)
    if (status >= 500) logger.emit('ERROR', 'orchestrator', err.message, { stack: err.stack })
    else stageLog('rejected', `${code || 'error'}: ${err.message}`)

    const body = {
      error: status >= 500 && !code ? 'Investigation interrupted by an internal error.' : err.message,
      errorCode: code || 'PIPELINE_ERROR',
    }
    if (SUGGESTIONS[code]) body.suggestion = SUGGESTIONS[code]
    else if (status >= 500) body.suggestion = 'Please try again in a moment.'
    if (process.env.NODE_ENV !== 'production') body.details = err.message
    return res.status(status).json(body)
  }
}

module.exports = { analyzeVideo, buildMatchedText }
