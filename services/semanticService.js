/**
 * semanticService.js
 * 
 * PHASE 4 V3: Streamlined Semantic Verification & Narrative Audit
 * Optimized for speed, authoritative reasoning, and direct contradiction detection.
 */

const { robustFetch } = require('../utils/apiClient');
const logger = require('../utils/pipelineLogger');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

/**
 * Main Entry Point for Phase 4: Streamlined Semantic Audit
 * NEW: Includes per-claim verification results from Phase 3
 */
async function runSemanticVerification(claims, evidenceArticles, originalSummary, claimVerifications = []) {
  const startTime = Date.now();
  const groqKey = process.env.GROQ_API_KEY;

  // If we have claim verifications from Phase 3, use them directly
  if (claimVerifications && claimVerifications.length > 0) {
    console.log('[semantic:v4] 📊 Using per-claim verification results from Phase 3...');
    
    // Calculate aggregate scores from claim verifications
    const supported = claimVerifications.filter(c => c.verdict === 'SUPPORTED').length;
    const refuted = claimVerifications.filter(c => c.verdict === 'REFUTED').length;
    const unverified = claimVerifications.filter(c => c.verdict === 'UNVERIFIED').length;
    const total = claimVerifications.length;
    
    // Calculate alignment based on claim verdicts
    const alignment = total > 0 
      ? Math.round((supported / total) * 100) 
      : (evidenceArticles && evidenceArticles.length > 0 ? 40 : 10);
    
    // Determine contradiction level
    let contradictionLevel = 'none';
    if (refuted > supported) contradictionLevel = 'high';
    else if (refuted > 0) contradictionLevel = 'moderate';
    else if (supported > 0) contradictionLevel = 'low';
    
    // Determine consensus state
    let consensusState = 'Insufficient Coverage';
    if (supported >= 2 && refuted === 0) consensusState = 'Strongly Supported';
    else if (supported >= 1 && refuted === 0) consensusState = 'Partially Verified';
    else if (refuted > 0 && supported === 0) consensusState = 'Contradicted';
    else if (refuted > 0 && supported > 0) consensusState = 'Mixed Evidence';
    else if (unverified > 0) consensusState = 'Unverified';
    
    // Build reasoning from claim verdicts
    const reasoningParts = [];
    if (supported > 0) reasoningParts.push(`${supported} claim(s) verified by external sources`);
    if (refuted > 0) reasoningParts.push(`${refuted} claim(s) contradicted by external sources`);
    if (unverified > 0) reasoningParts.push(`${unverified} claim(s) could not be verified`);
    
    const durationMs = Date.now() - startTime;
    
    return {
      narrativeAlignment: alignment,
      contradictionLevel,
      consensusState,
      semanticConfidence: Math.min(100, Math.max(20, alignment + 10)),
      narrativeReasoning: reasoningParts.join('. ') + '.',
      claimVerifications, // Pass through the per-claim results
      supportingSources: evidenceArticles.filter(a => a.stance === 'support'),
      contradictingSources: evidenceArticles.filter(a => a.stance === 'refute'),
      metadata: { 
        processingTimeMs: durationMs,
        claimsVerified: total,
        supported,
        refuted,
        unverified
      }
    };
  }

  // Fallback: Original holistic audit if no claim verifications
  if (!groqKey || !evidenceArticles || evidenceArticles.length === 0) {
    return getFallbackVerificationSignals(evidenceArticles);
  }

  // 1. Prepare Narrative Context
  const claimsText = (claims && claims.length > 0)
    ? claims.map(c => `- ${c.claim || c}`).join('\n')
    : `Primary Narrative: ${originalSummary}`;

  // 2. Prepare Evidence Context (Summarized for the LLM)
  const articleContext = (evidenceArticles || []).slice(0, 6).map((a, i) => {
    return `[Evidence ${i+1}: ${a.source}] ${a.title}: ${a.aiSummary || a.summary || (a.body ? a.body.slice(0, 400) : '')}`;
  }).join('\n\n');

  // 3. Holistic Semantic Audit
  const prompt = `
    Persona: Senior Investigative Editor.
    Task: Conduct a high-fidelity semantic audit comparing the SUBJECT NARRATIVE against EXTERNAL JOURNALISTIC EVIDENCE.
    
    SUBJECT NARRATIVE / CLAIMS:
    ${claimsText}
    
    EXTERNAL JOURNALISTIC EVIDENCE:
    ${articleContext}
    
    INVESTIGATIVE GOALS:
    - ALIGNMENT: How well does the institutional evidence support the subject narrative? (0-100)
    - CONTRADICTION: Are there direct factual conflicts? (none | low | moderate | high)
    - CONSENSUS: Strongly Supported | Partially Verified | Contradicted | Insufficient Coverage
    - REASONING: Professional 2-3 sentence explanation of the evidentiary relationship.

    RETURN JSON:
    {
      "narrativeAlignment": 0-100,
      "contradictionLevel": "...",
      "consensusState": "...",
      "semanticConfidence": 0-100,
      "narrativeReasoning": "...",
      "supportingIndices": [indices of supporting evidence],
      "contradictingIndices": [indices of contradicting evidence]
    }
  `;

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: { 
        model: GROQ_MODEL, 
        messages: [{ role: 'user', content: prompt }], 
        temperature: 0.1, 
        response_format: { type: "json_object" } 
      },
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'semantic-audit' });
    
    const parsed = JSON.parse(data.choices[0].message.content);
    const durationMs = Date.now() - startTime;

    logger.logSemantic({
      narrativeAlignment: parsed.narrativeAlignment,
      consensusState: parsed.consensusState,
      durationMs
    });

    return {
      ...parsed,
      supportingSources: (parsed.supportingIndices || []).map(idx => evidenceArticles[idx]).filter(Boolean),
      contradictingSources: (parsed.contradictingIndices || []).map(idx => evidenceArticles[idx]).filter(Boolean),
      metadata: { processingTimeMs: durationMs }
    };
  } catch (err) {
    logger.emit('ERROR', 'semantic', 'Audit failed', { error: err.message });
    return getFallbackVerificationSignals(evidenceArticles);
  }
}

function getFallbackVerificationSignals(evidence) {
  const hasEvidence = evidence && evidence.length > 0;
  return {
    narrativeAlignment: hasEvidence ? 40 : 10,
    contradictionLevel: 'none',
    consensusState: hasEvidence ? 'Partially Verified' : 'Insufficient Coverage',
    semanticConfidence: 30,
    narrativeReasoning: "Evidence coverage is limited; narrative alignment remains in-progress.",
    supportingSources: evidence || [],
    contradictingSources: [],
    metadata: { isFallback: true }
  };
}

module.exports = { runSemanticVerification };
