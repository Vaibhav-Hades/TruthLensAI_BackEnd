/**
 * credibilityService.js
 *
 * PHASE 5: Final synthesis. The verdict comes from classificationService (evidence-based,
 * deterministic). The LLM is used ONLY to word the explanation of that verdict; it cannot
 * change the verdict.
 */

const { robustFetch } = require('../utils/apiClient');
const { GROQ_API_URL, GROQ_MODEL } = require('../config/llm');
const { classify } = require('./classificationService');

async function generateCredibilityReport(pipelineData) {
  const { intelligence, liveNarrative = {}, semanticSignals = {}, referenceMatches = [], pipeline = {} } = pipelineData;

  const claimVerifications = liveNarrative.claimVerifications || semanticSignals.claimVerifications || [];
  const metadataOnly = /metadata/.test(pipeline.metadata?.transcriptSource || '');

  const classification = classify({
    claimVerifications,
    referenceMatches,
    context: { metadataOnly, retrievalStatus: liveNarrative.retrievalStatus }
  });

  const reasoning = await generateHumanizedReasoning({ classification, claimVerifications, liveNarrative, referenceMatches, pipeline, metadataOnly });

  return {
    summary: intelligence.summary,
    videoSummary: intelligence.videoSummary || intelligence.summary,
    entities: intelligence.entities,
    keywords: intelligence.keywords,
    claims: intelligence.claims,
    claimVerifications,
    supportingArticles: liveNarrative.supportingArticles || [],
    contradictingArticles: liveNarrative.contradictingArticles || [],
    narrativeAlignment: semanticSignals.narrativeAlignment ?? classification.truthScore,
    contradictionLevel: semanticSignals.contradictionLevel || 'none',
    credibilityScore: classification.truthScore,
    confidence: classification.confidence,
    prediction: classification.prediction,
    classification,
    verdict: classification.legacyVerdict,
    reasoning,
    metadata: {
      processedAt: new Date().toISOString(),
      version: '4.0.0-EvidenceClassifier',
      sourceTraceability: `Checked against ${liveNarrative.articleSummaries?.length || 0} external reports.`,
      claimsVerified: claimVerifications.length
    }
  };
}

/** Plain-language fallback that is built only from the real signals (no LLM needed). */
function templateExplanation({ classification, liveNarrative, referenceMatches, pipeline, metadataOnly }) {
  const s = classification.signals;
  const parts = [classification.reason];
  if (s.totalClaims) {
    parts.push(`Of ${s.totalClaims} claim(s) checked, ${s.supported} were supported, ${s.refuted} contradicted and ${s.unverified} could not be verified.`);
  }
  const n = liveNarrative.articleSummaries?.length || 0;
  parts.push(n ? `${n} related news report(s) were reviewed.` : 'No related news reports were retrieved.');
  if (referenceMatches.length) parts.push('Similar items exist in the reference dataset; similarity shows topical overlap only and is not proof either way.');
  if (metadataOnly) parts.push('Only the video title and channel were available (no transcript), so confidence is limited.');
  else if (pipeline.metadata?.fallbackUsed) parts.push('A secondary AI transcription was used because captions were unavailable.');
  return parts.join(' ');
}

async function generateHumanizedReasoning(data) {
  const fallback = templateExplanation(data);
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return fallback;

  const facts = {
    prediction: data.classification.prediction,
    confidence: data.classification.confidence,
    reason: data.classification.reason,
    signals: data.classification.signals,
    claims: data.claimVerifications.slice(0, 5).map(c => ({ claim: c.claim, verdict: c.verdict, reasoning: c.reasoning })),
    articlesReviewed: data.liveNarrative.articleSummaries?.length || 0,
    inputKind: data.pipeline.metadata?.type || 'text',
    onlyTitleWasAnalysed: Boolean(data.metadataOnly)
  };

  const prompt = `You are a news editor. Write a short explanation (max 4 sentences, plain language, no jargon) of this fact-check outcome.
Use ONLY the facts below. Do not change or second-guess the prediction, and do not invent sources or numbers.
If there was little evidence, say verification was limited. Mention that only the title was analysed ONLY when onlyTitleWasAnalysed is true; otherwise never mention metadata. If news retrieval was unavailable (see reason), say the claims could not be checked against news reports. Refer to claims as claims, not as evidence.

FACTS: ${JSON.stringify(facts)}`;

  try {
    const res = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 400 },
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'humanized-reasoning', retries: 1 });
    const text = res.choices?.[0]?.message?.content?.trim();
    return text || fallback;
  } catch (err) {
    console.warn('[credibility] Reasoning synthesis failed:', err.message);
    return fallback;
  }
}

module.exports = { generateCredibilityReport, templateExplanation };
