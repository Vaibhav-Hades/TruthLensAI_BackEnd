const { runPhase1Pipeline } = require('../services/pipelineService')
const { runPhase2Intelligence, getFallbackIntelligence } = require('../services/intelligenceService')
const { analyzeLiveNarrative } = require('../services/eventRegistryService')
const { runSemanticVerification } = require('../services/semanticService')
const { generateCredibilityReport } = require('../services/credibilityService')
const logger = require('../utils/pipelineLogger')

/**
 * analyzeController.js
 * 
 * MASTER LINEAR ORCHESTRATOR (Restored V2 Architecture)
 * 
 * Transforms the TruthLens AI pipeline into a production-grade, 
 * deterministic investigative sequence:
 * 
 * 1. Extraction (Phase 1)
 * 2. Intelligence Generation (Phase 2)
 * 3. Evidence Retrieval (Phase 3)
 * 4. Semantic Narrative Audit (Phase 4)
 * 5. Credibility & Verdict Synthesis (Phase 5)
 */

async function stageLog(stage, msg, data) {
  logger.emit('INFO', `analyze:${stage}`, msg, data ? { data: typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data) } : {});
}

async function analyzeVideo(req, res, next) {
  const startTimeTotal = Date.now();
  const stageTimings = {};

  try {
    const { url, contentType } = req.body;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'Content input is required.', errorCode: 'INVALID_INPUT' });
    }

    stageLog('init', 'Starting verified investigative sequence...', { url: url.slice(0, 50) });

    // ── STEP 1: EXTRACTION (PHASE 1) ──
    const startP1 = Date.now();
    const pipelineResult = await runPhase1Pipeline(url.trim());
    stageTimings['extraction'] = Date.now() - startP1;
    stageLog('phase1', `Extraction complete. Length: ${pipelineResult.cleanedTranscript.length} chars.`);

    // ── STEP 2: INTELLIGENCE GENERATION (PHASE 2) ──
    const startP2 = Date.now();
    let intelligence;
    try {
      intelligence = await runPhase2Intelligence(pipelineResult);
    } catch (err) {
      stageLog('phase2', 'Intelligence failed, using fallback', { err: err.message });
      intelligence = getFallbackIntelligence(pipelineResult.cleanedTranscript);
    }
    stageTimings['intelligence'] = Date.now() - startP2;

    // ── STEP 3: EVIDENCE RETRIEVAL (PHASE 3) ──
    const startP3 = Date.now();
    const liveNarrative = await analyzeLiveNarrative(pipelineResult.cleanedTranscript, intelligence);
    stageTimings['retrieval'] = Date.now() - startP3;

    // ── STEP 4: SEMANTIC NARRATIVE AUDIT (PHASE 4) ──
    const startP4 = Date.now();
    const semanticSignals = await runSemanticVerification(
      intelligence.extractedClaims || intelligence.claims || [],
      liveNarrative.articleSummaries || [],
      intelligence.humanizedSummary || intelligence.summary,
      liveNarrative.claimVerifications || [] // Pass claim verifications from Phase 3
    );
    stageTimings['semantic_audit'] = Date.now() - startP4;

    // ── STEP 5: CREDIBILITY & VERDICT SYNTHESIS (PHASE 5) ──
    const startP5 = Date.now();
    const report = await generateCredibilityReport({
      intelligence,
      liveNarrative,
      semanticSignals,
      pipeline: {
        metadata: pipelineResult.metadata
      }
    });
    stageTimings['synthesis'] = Date.now() - startP5;

    // ── STEP 6: FINAL RESPONSE ASSEMBLY ──
    const totalTime = Date.now() - startTimeTotal;
    stageLog('finalize', `Investigation complete in ${totalTime}ms`);

    // Collective evidence list for frontend SourcePanel
    const matchedSources = [
      ...(liveNarrative.articleSummaries || [])
    ].map(art => ({
      title: art.title,
      url: art.url,
      source: art.source,
      publishDate: art.publishDate,
      image: art.image,
      aiSummary: art.aiSummary,
      stance: art.stance,
      relevanceScore: art.relevanceScore,
      matchedEntities: art.matchedEntities || [],
      matchedClaims: art.matchedClaims || [],
      evidenceType: art.evidenceType || 'Institutional Report'
    }));

    return res.status(200).json({
      summary: report.summary,
      videoSummary: report.videoSummary || report.summary,
      meaning: intelligence.meaning,
      keywords: intelligence.keywords || [],
      claims: intelligence.extractedClaims || intelligence.claims || [],
      claimVerifications: report.claimVerifications || [], // NEW: Per-claim verification results
      explanation: report.reasoning,
      verdict_label: report.verdict,
      verdict: report.verdict, // frontend Results.jsx expects `verdict`
      truthScore: report.credibilityScore,
      scoreConfidence: report.confidence,
      matchedSources: matchedSources,
      liveNarrativeAnalysis: liveNarrative,
      semanticAnalysis: {
        narrativeAlignment: report.narrativeAlignment,
        contradictionLevel: report.contradictionLevel,
        reasoning: report.reasoning
      },
      pipeline: {
        sourceType: pipelineResult.sourceType,
        metadata: pipelineResult.metadata
      },
      // Expanded Keyword & Entity Extraction Engine fields (Step 5)
      extractedEntities: intelligence.extractedEntities || [],
      narrativeTopics: intelligence.narrativeTopics || [],
      retrievalSignals: intelligence.retrievalSignals || {},
      keywordRelevance: intelligence.keywordRelevance || {},

      analysisId: Buffer.from(url.trim().slice(0, 32) + Date.now()).toString('base64').slice(0, 12),
      _diagnostics: {
        timings: stageTimings,
        totalTime
      }
    });

  } catch (err) {
    logger.emit('ERROR', 'orchestrator', err.message, { stack: err.stack });
    return res.status(500).json({
      error: 'Investigation interrupted by an internal error.',
      errorCode: 'PIPELINE_ERROR',
      suggestion: 'The neural core encountered an unexpected state. Please try again.',
      details: err.message
    });
  }
}

module.exports = { analyzeVideo };
