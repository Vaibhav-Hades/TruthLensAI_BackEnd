/**
 * credibilityService.js
 * 
 * PHASE 5 V2: Production-Grade Credibility Analysis & Humanized Verdict Engine
 * 
 * Final synthesis of all intelligence signals into a stable, explainable, 
 * and trustworthy verification result.
 */

const { robustFetch } = require('../utils/apiClient');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama3-8b-8192';

/**
 * Main Entry Point for Phase 5 V2: Credibility & Verdict Synthesis
 */
async function generateCredibilityReport(pipelineData) {
  const { 
    intelligence, 
    liveNarrative, 
    semanticSignals 
  } = pipelineData;

  // STEP 1 & 2: Credibility Scoring & Source Weighting
  const alignment = semanticSignals?.narrativeAlignment || 50;
  const semanticConfidence = semanticSignals?.semanticConfidence || 50;
  const trustedCoverage = liveNarrative?.sourceMetadata?.trustedCoverage || 0;
  const contradictionLevel = semanticSignals?.contradictionLevel || 'none';

  // Base score heavily weighted toward narrative alignment and semantic confidence
  let credibilityScore = (alignment * 0.6) + (semanticConfidence * 0.4);

  // Apply Source Trust Bonus (Phase 3 Priority)
  if (trustedCoverage >= 2) credibilityScore += 10;
  else if (trustedCoverage === 1) credibilityScore += 5;

  // Apply Contradiction & Accuracy Penalties (Phase 4 Signals)
  if (contradictionLevel === 'high') credibilityScore -= 30;
  else if (contradictionLevel === 'moderate') credibilityScore -= 15;

  const signals = semanticSignals?.analysisSignals || {};
  if (signals.framingAccuracy === 'misleading') credibilityScore -= 15;
  if (signals.factualConsistency === 'low') credibilityScore -= 10;
  if (signals.sourceAgreement === 'divided') credibilityScore -= 5;

  // Normalize score
  credibilityScore = Math.max(0, Math.min(100, Math.round(credibilityScore)));

  // STEP 3: Confidence Calibration
  // Confidence is high if we have strong alignment OR strong contradictions
  // Confidence is low if coverage is insufficient
  let confidence = (semanticConfidence * 0.7) + (Math.min(trustedCoverage, 3) * 10);
  if (liveNarrative?.articleSummaries?.length === 0) confidence = Math.min(confidence, 30);
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  // STEP 4: Verdict Generation
  const verdict = generateFinalVerdict(credibilityScore, semanticSignals?.consensusState, trustedCoverage);

  // STEP 5 & 6: Humanized AI Reasoning
  const reasoning = await generateHumanizedReasoning({
    verdict,
    credibilityScore,
    confidence,
    semanticSignals,
    intelligence,
    liveNarrative,
    pipeline: pipelineData.pipeline // Pass pipeline metadata for humanized explanation
  });

  return {
    summary: intelligence.summary,
    entities: intelligence.entities,
    keywords: intelligence.keywords,
    claims: intelligence.claims,
    supportingArticles: liveNarrative.supportingArticles || [],
    contradictingArticles: liveNarrative.contradictingArticles || [],
    narrativeAlignment: alignment,
    contradictionLevel,
    credibilityScore,
    confidence,
    verdict,
    reasoning,
    metadata: {
      processedAt: new Date().toISOString(),
      version: '2.0.0-Verdict',
      sourceTraceability: `Verified against ${liveNarrative.articleSummaries?.length || 0} external reports.`
    }
  };
}

/**
 * STEP 4: Final Verdict Engine
 */
function generateFinalVerdict(score, consensus, trustedCount) {
  const c = String(consensus).toLowerCase();

  if (trustedCount === 0 || c.includes('insufficient')) {
    return 'Needs Verification';
  }

  if (c.includes('contradicted') || score < 40) {
    return 'Contradicted by Sources';
  }

  if (score >= 80 && trustedCount >= 2) {
    return 'Likely Credible';
  }

  if (score >= 60) {
    return 'Partially Verified';
  }

  return 'Likely Misleading';
}

/**
 * STEP 5: Humanized AI Reasoning Engine
 */
async function generateHumanizedReasoning(data) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return data.semanticSignals?.narrativeReasoning || "Analysis complete.";

  const prompt = `
    Persona: Chief News Editor & Investigative Analyst
    Task: Provide a final, authoritative "Editor's Brief" for this verification.
    
    FINDINGS:
    - Verdict: ${data.verdict}
    - Trust Score: ${data.credibilityScore}/100
    - Confidence Rating: ${data.confidence}%
    - Narrative Consistency: ${data.semanticSignals?.narrativeAlignment}%
    - Core Insight: ${data.semanticSignals?.narrativeReasoning}
    - Pipeline Metadata: Source: ${data.pipeline?.metadata?.transcriptSource}, Confidence: ${data.pipeline?.metadata?.transcriptConfidence}%, Fallback: ${data.pipeline?.metadata?.fallbackUsed ? 'Yes' : 'No'}, Audio Quality: ${data.pipeline?.metadata?.audioQuality}
    
    REQUIREMENTS:
    1. STYLE: Explain the verification outcome in fluid, conversational, and plain language.
    2. AUDIENCE: Professional human users seeking absolute clarity.
    3. TRANSCRIPT CONTEXT: If fallback was used or audio quality is low, explain it naturally (e.g. "Our analysis utilized a secondary AI transcription due to the absence of native subtitles.").
    4. LOW EVIDENCE: If institutional coverage is sparse, use: "Trusted external reporting related to this specific topic was limited, making full verification difficult at this time."
    5. AVOID JARGON: Strictly avoid "Forensic", "Semantic", "Contradiction Level", "Calibration", or machine-style labels.
    
    Max 4 concise, impactful sentences.
  `;

  try {
    const res = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 500 },
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'humanized-reasoning' });
    
    return res.choices[0].message.content.trim();
  } catch (err) {
    console.warn('[credibility:v2] Reasoning synthesis failed:', err.message);
    return data.semanticSignals?.narrativeReasoning || "Final verdict established based on available journalistic evidence.";
  }
}

module.exports = { generateCredibilityReport };
