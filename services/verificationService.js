/**
 * verificationService.js
 * 
 * RESTORED V2: Clean, Fast, and Reliable Verification Orchestrator
 * Simplifies the pipeline to its core efficient flow: 
 * Intelligence → Retrieval → Semantic Audit → Humanized Verdict.
 */

const { runPhase2Intelligence } = require('./intelligenceService');
const { analyzeLiveNarrative } = require('./eventRegistryService');
const { runSemanticVerification } = require('./semanticService');
const logger = require('../utils/pipelineLogger');

/**
 * The Master Verification Orchestrator.
 * Fully linear, fast, and authoritative.
 */
async function performFullVerification(pipelineResult) {
  const startTime = Date.now();
  console.log('[verification:v2] 🚀 Initiating Core Investigative Audit...');

  try {
    // 1. PHASE 2: Narrative Intelligence & Search Signals
    // Generates the humanized summary, entities, and keywords.
    const intelligence = await runPhase2Intelligence(pipelineResult);

    // 2. PHASE 3: Evidence Retrieval (EventRegistry)
    // Fetches real articles using intelligence search signals.
    const evidence = await analyzeLiveNarrative(pipelineResult, intelligence);

    // 3. PHASE 4: Semantic Audit & Narrative Comparison
    // Intelligent comparison between the transcript narrative and the evidence.
    const semanticResult = await runSemanticVerification(
      intelligence.extractedClaims || intelligence.claims || [],
      evidence.articleSummaries || [],
      intelligence.humanizedSummary || intelligence.summary || ''
    );

    // 4. Score Aggregation & Final Calibration
    const truthScore = calculateFinalTruthScore(semanticResult, evidence.narrativeAlignmentScore || 50);
    const durationMs = Date.now() - startTime;

    console.log(`[verification:v2] ✅ Audit Complete. Final Score: ${truthScore}/100 in ${durationMs}ms`);

    return {
      // Primary Result Data
      truthScore,
      summary: intelligence.humanizedSummary || intelligence.summary,
      contextualNarrative: intelligence.contextualNarrative,
      meaning: intelligence.meaning,
      verdict_label: mapScoreToVerdict(truthScore, semanticResult.consensusState),
      
      // Verification Intelligence
      reasoning: semanticResult.narrativeReasoning,
      consensus: semanticResult.consensusState,
      confidence: semanticResult.semanticConfidence || 75,
      
      // Evidence & Entities
      matchedSources: evidence.articleSummaries || [],
      supportingCount: evidence.supportingArticles?.length || 0,
      contradictingCount: evidence.contradictingArticles?.length || 0,
      entities: intelligence.extractedEntities || intelligence.entities || [],
      keywords: intelligence.extractedKeywords || intelligence.keywords || [],
      claims: intelligence.extractedClaims || intelligence.claims || [],
      
      // Narrative Context
      narrativeAnalysis: {
        alignment: semanticResult.narrativeAlignment,
        contradiction: semanticResult.contradictionLevel,
        framing: semanticResult.analysisSignals?.framingAccuracy || 'neutral'
      },
      
      // Metadata
      metadata: {
        ...pipelineResult.metadata,
        processingTimeMs: durationMs,
        pipelineVersion: 'V2-Simplified-Stable',
        model: 'llama-3.1-8b-instant'
      }
    };

  } catch (error) {
    logger.emit('ERROR', 'verification', 'Master Pipeline Failure', { error: error.message });
    throw error;
  }
}

/**
 * Maps the final numerical truth score to a believable journalistic verdict.
 */
function mapScoreToVerdict(score, consensus) {
  if (consensus === 'Contradicted') return 'Fabricated / Contradicted';
  if (score >= 85) return 'Highly Credible';
  if (score >= 65) return 'Partially Verified';
  if (score >= 40) return 'Questionable / Needs Context';
  if (score >= 20) return 'Likely Misleading';
  return 'False / Disproven';
}

/**
 * Calculates a stable, deterministic truth score based on semantic alignment and retrieval consensus.
 */
function calculateFinalTruthScore(semantic, retrievalAlignment) {
  const semanticWeight = 0.7;
  const retrievalWeight = 0.3;

  const baseScore = (semantic.narrativeAlignment * semanticWeight) + (retrievalAlignment * retrievalWeight);
  
  // Apply Penalties/Boosts based on consensus state
  let finalScore = baseScore;
  
  if (semantic.consensusState === 'Contradicted') {
    finalScore = Math.min(finalScore, 25); // Hard cap on contradiction
  } else if (semantic.consensusState === 'Strongly Supported') {
    finalScore = Math.max(finalScore, 85); // High floor for strong consensus
  }

  // Adjust for semantic confidence
  const confidenceFactor = (semantic.semanticConfidence || 50) / 100;
  if (confidenceFactor < 0.4) {
    // If confidence is very low, pull the score toward neutral (50)
    finalScore = (finalScore + 50) / 2;
  }

  return Math.round(Math.min(100, Math.max(0, finalScore)));
}

module.exports = { performFullVerification };
