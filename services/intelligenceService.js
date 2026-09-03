/**
 * intelligenceService.js
 * 
 * PHASE 2 V6: Semantic Narrative Intelligence & Keyword Engine
 * Rebuilt to integrate the TruthLens AI Keyword + Entity Extraction Engine.
 * Extracts keywords/entities directly from the clean summary and context.
 */

const { robustFetch } = require('../utils/apiClient');
const logger = require('../utils/pipelineLogger');
const { generateCleanSummary, generateFallbackSummary } = require('./cleanSummaryEngine');
const { extractKeywordsAndEntities, localFallbackExtract } = require('./keywordExtractionEngine');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

/**
 * Main entry point for Phase 2 Intelligence.
 * Orchestrates: Understanding → Merging → Clean Summary Engine → Keyword extraction → Claims Extraction.
 */
async function runPhase2Intelligence(pipelineResult) {
  const { chunks, cleanedTranscript } = pipelineResult;
  const startTime = Date.now();
  
  if (!cleanedTranscript || cleanedTranscript.trim().length === 0) {
    throw new Error('Intelligence engine received empty transcript.');
  }

  try {
    let narrativeMap = "Single-pass extraction active.";
    
    // STEP 1 & 2 REFINED: Adaptive Intelligence Path
    // Short content (under 4000 chars) doesn't need chunk-level reasoning
    if (cleanedTranscript.length > 4000 && chunks.length > 1) {
      stageLog('intelligence', `Long-form content detected (${chunks.length} chunks). Initiating multi-stage understanding...`);
      const chunkIntelligence = await Promise.all(
        chunks.slice(0, 5).map((chunk, idx) => understandChunk(chunk, idx, chunks.length))
      );
      narrativeMap = await mergeNarrativeMap(chunkIntelligence);
    } else {
      stageLog('intelligence', 'Standard-length content detected. Using single-pass semantic extraction.');
    }

    // Call our stabilized Clean Summary Engine
    const cleanSummaryResult = await generateCleanSummary(cleanedTranscript, pipelineResult.metadata || {});

    // Call our newly built Keyword & Entity Extraction Engine (from Clean Summary + Context)
    const keywordResult = await extractKeywordsAndEntities(
      cleanSummaryResult.cleanSummary, 
      cleanSummaryResult.contextualNarrative, 
      pipelineResult.metadata || {}
    );

    // STEP 3: HIGH-FIDELITY EXTRACTION
    const extractionInput = cleanedTranscript.slice(0, 8000);
    const intelligence = await extractNarrativeIntelligence(
      extractionInput, 
      narrativeMap, 
      cleanSummaryResult, 
      keywordResult
    );
    
    const durationMs = Date.now() - startTime;

    logger.logIntelligence({
      summaryLen: intelligence.summary?.length || 0,
      claimsCount: intelligence.claims?.length || 0,
      entitiesCount: intelligence.entities?.length || 0,
      durationMs
    });

    return {
      ...intelligence,
      metadata: {
        totalChunksProcessed: chunks.length,
        processingTimeMs: durationMs,
        path: cleanedTranscript.length > 4000 ? 'multi-stage' : 'single-pass',
        version: '6.0.0-KeywordExtractionEngine'
      }
    };
  } catch (error) {
    logger.emit('ERROR', 'intelligence', 'Intelligence stage failure', { error: error.message });
    return getFallbackIntelligence(cleanedTranscript, pipelineResult.metadata);
  }
}

function stageLog(stage, msg) {
  logger.emit('INFO', `intelligence:${stage}`, msg);
}

/**
 * Step 3: Chunk-Level Understanding
 */
async function understandChunk(text, index, total) {
  const prompt = `
    Persona: Senior Investigative Analyst.
    Task: Extract narrative heartbeat for segment (${index + 1}/${total}).
    Content: ${text.slice(0, 3800)}
  `;
  try { 
    const result = await callGroq(prompt, 300);
    return `[SEGMENT ${index + 1}]: ${result.trim()}`;
  } catch (e) { return `[SEGMENT ${index + 1}]: Processed.`; }
}

/**
 * Step 4: Narrative Merging
 */
async function mergeNarrativeMap(chunkAnalyses) {
  const prompt = `
    Persona: Lead Intelligence Editor.
    Task: Synthesize segments into a master narrative intelligence map.
    Analyses: ${chunkAnalyses.join('\n\n')}
  `;
  try { return await callGroq(prompt, 600); } catch (e) { return chunkAnalyses.join(' '); }
}

/**
 * Advanced Claims Narrative Intelligence Extraction
 * Anchors the claim extraction on the pre-generated clean summary and entities.
 * NEW: Extracts specific STATEMENTS made by the speaker that can be fact-checked.
 */
async function extractNarrativeIntelligence(text, narrativeMap, cleanSummaryResult, keywordResult) {
  const prompt = `
    Persona: Lead Investigative Intelligence Lead.
    Task: Extract specific STATEMENTS made in the content that can be fact-checked against news sources.

    CONTEXTUAL NARRATIVE MAP:
    ${narrativeMap}

    PRE-GENERATED SUMMARY & CONTEXT:
    - Executive Summary: ${cleanSummaryResult.cleanSummary}
    - Contextual Narrative: ${cleanSummaryResult.contextualNarrative}

    EXTRACTED SEMANTIC ENTITIES & KEYWORDS (Anchoring entities):
    - Entities: ${keywordResult.extractedEntities.join(', ')}
    - Keywords: ${keywordResult.extractedKeywords.join(', ')}
    - Narrative Topics: ${keywordResult.narrativeTopics.join(', ')}

    SOURCE CONTENT:
    ${text.slice(0, 5000)}

    EXTRACTION RULES:
    1. extractedClaims: Specific STATEMENTS the speaker makes as facts. Each claim must be:
       - A clear, verifiable assertion (not opinion or speculation)
       - Something that can be confirmed or refuted by news articles
       - Structure: { claim, context, confidence, entities, searchQuery, category }
       - searchQuery: A search query to find articles that verify this specific claim
    2. videoSummary: A comprehensive summary of what the video/content is ABOUT (the main topic, not just claims)
    3. verdict_label: Provide a high-integrity preliminary verdict (Likely Credible, Questionable, Misleading, Fabricated)
    4. meaning: The ultimate core takeaway or intent behind the speech/content

    IMPORTANT: Focus on STATEMENTS THAT CAN BE VERIFIED, not opinions or general commentary.
    Example GOOD claims:
    - "The Prime Minister announced new policy X on date Y"
    - "Company ABC reported revenue of $Z billion in Q3"
    - "The earthquake measured 7.2 on the Richter scale"
    Example BAD claims (opinions, not verifiable):
    - "This policy is good for the economy"
    - "People are angry about this"

    RETURN ONLY JSON:
    {
      "extractedClaims": [
        { 
          "claim": "Specific verifiable statement made by the speaker",
          "context": "Brief context of when/how this was stated",
          "confidence": 95,
          "entities": ["Person/Org/Location mentioned"],
          "searchQuery": "specific search terms to find verifying articles",
          "category": "Political|Economic|Health|Security|Technology|Social"
        }
      ],
      "videoSummary": "Comprehensive summary of what the video is about (2-3 sentences)",
      "verdict_label": "Likely Credible|Questionable|Misleading|Fabricated",
      "meaning": "The ultimate narrative takeaway."
    }
  `;

  try {
    const response = await callGroq(prompt, 1000, true);
    const parsed = JSON.parse(response);

    return {
      // Legacy Fields (strictly required by credibilityService, analyzeController, etc.)
      summary: parsed.videoSummary || cleanSummaryResult.cleanSummary,
      meaning: parsed.meaning || cleanSummaryResult.contextualNarrative.split('.')[0] || cleanSummaryResult.cleanSummary.split('.')[0],
      entities: keywordResult.extractedEntities,
      keywords: keywordResult.extractedKeywords,
      claims: (parsed.extractedClaims || []).map(c => ({
        claim: c.claim,
        category: c.category || 'General',
        entities: c.entities || []
      })),
      verdict_label: parsed.verdict_label || "Questionable",

      // New Production Engine Fields
      cleanSummary: cleanSummaryResult.cleanSummary,
      humanizedSummary: cleanSummaryResult.cleanSummary,
      contextualNarrative: cleanSummaryResult.contextualNarrative,
      extractedKeywords: keywordResult.extractedKeywords,
      extractedEntities: keywordResult.extractedEntities,
      extractedClaims: parsed.extractedClaims || [],
      videoSummary: parsed.videoSummary || cleanSummaryResult.cleanSummary,
      narrativeTopics: keywordResult.narrativeTopics,
      retrievalSignals: keywordResult.retrievalSignals,
      keywordRelevance: keywordResult.keywordRelevance,
      semanticMetadata: { 
        tone: cleanSummaryResult.contextualNarrative.toLowerCase().includes('conspir') ? 'biased' : 'neutral', 
        controversyLevel: cleanSummaryResult.contextualNarrative.toLowerCase().includes('controvers') ? 'High' : 'Low' 
      },
      summaryConfidence: cleanSummaryResult.summaryConfidence
    };
  } catch (e) {
    logger.emit('ERROR', 'intelligence', 'Claims extraction failed, compiling fallback context', { error: e.message });
    
    // Recovery block: return structured elements using the pre-generated keyword engine data
    return {
      summary: cleanSummaryResult.cleanSummary,
      meaning: cleanSummaryResult.contextualNarrative.split('.')[0],
      entities: keywordResult.extractedEntities,
      keywords: keywordResult.extractedKeywords,
      claims: [],
      verdict_label: "Questionable",
      cleanSummary: cleanSummaryResult.cleanSummary,
      humanizedSummary: cleanSummaryResult.cleanSummary,
      contextualNarrative: cleanSummaryResult.contextualNarrative,
      extractedKeywords: keywordResult.extractedKeywords,
      extractedEntities: keywordResult.extractedEntities,
      extractedClaims: [],
      narrativeTopics: keywordResult.narrativeTopics,
      retrievalSignals: keywordResult.retrievalSignals,
      keywordRelevance: keywordResult.keywordRelevance,
      semanticMetadata: { tone: 'neutral', controversyLevel: 'Low' },
      summaryConfidence: cleanSummaryResult.summaryConfidence
    };
  }
}

async function callGroq(prompt, maxTokens, isJson = false) {
  const payload = {
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  if (isJson) payload.response_format = { type: "json_object" };

  const data = await robustFetch({
    method: 'post',
    url: GROQ_API_URL,
    data: payload,
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }
  }, { stage: 'intelligence-generation' });

  return data.choices[0].message.content;
}

function getFallbackIntelligence(text, metadata = {}) {
  const fallback = generateFallbackSummary(text, metadata);
  const kwFallback = localFallbackExtract(fallback.cleanSummary, fallback.contextualNarrative, metadata);
  
  return {
    summary: fallback.cleanSummary,
    humanizedSummary: fallback.cleanSummary,
    contextualNarrative: fallback.contextualNarrative,
    summaryConfidence: fallback.summaryConfidence,
    
    extractedEntities: kwFallback.extractedEntities,
    extractedKeywords: kwFallback.extractedKeywords,
    extractedClaims: [],
    
    verdict_label: "Needs Verification",
    meaning: fallback.contextualNarrative.split('.')[0] || fallback.cleanSummary.split('.')[0],
    
    entities: kwFallback.extractedEntities,
    keywords: kwFallback.extractedKeywords,
    claims: [],
    
    narrativeTopics: kwFallback.narrativeTopics,
    retrievalSignals: kwFallback.retrievalSignals,
    keywordRelevance: kwFallback.keywordRelevance
  };
}

module.exports = { runPhase2Intelligence, getFallbackIntelligence };
