/**
 * keywordExtractionEngine.js
 * 
 * TruthLens AI Keyword + Entity Extraction Engine
 * 
 * Rebuilt and stabilized to extract highly meaningful, retrieval-ready keywords
 * and entities directly from the clean summary and contextual narrative.
 * 
 * TARGET FLOW:
 * Clean Summary -> Narrative Understanding -> Entity Extraction -> Keyword Extraction -> Retrieval-Ready Intelligence -> Frontend Transparency
 */

const { robustFetch } = require('../utils/apiClient');
const cache = require('./cacheService');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

// Standard English stopwords plus weak conversational words to completely remove (Step 2)
const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','it','its','this','that','was','are','be','been','have','has','had',
  'he','she','they','we','you','i','my','his','her','their','our','your',
  'so','as','if','by','from','up','about','into','than','then','when',
  'there','here','what','which','who','how','all','just','also','more',
  'not','no','do','did','does','will','would','could','should','can','may',
  'very','really','quite','rather','such','much','many','some','any','each',
  'every','both','few','most','other','another','same','own','only','even',
  'well','just','actually','basically','literally','really','very','thing',
  'getting','know','people','about','video','content','media','report','story',
  'article','post','page','site','someone','anyone','something','anything',
  'everything','nothing'
]);

/**
 * High-Quality Deterministic Fallback Keyword Extractor
 * Used when the Groq API key is missing or the external API call fails.
 * Extracts capitalized proper nouns as entities, groups them semantically,
 * filters weak terms, and calculates relevance scores deterministically.
 */
function localFallbackExtract(cleanSummary, contextualNarrative, metadata = {}) {
  const combinedText = `${cleanSummary} ${contextualNarrative}`;
  
  // 1. Extract potential proper noun entities (capitalized word sequences)
  const entityMatches = combinedText.match(/\b[A-Z][a-zA-Z]{3,}(?:\s+[A-Z][a-zA-Z]{3,}){0,2}\b/g) || [];
  
  const entityFreq = {};
  entityMatches.forEach(ent => {
    const lower = ent.toLowerCase().trim();
    if (!STOPWORDS.has(lower)) {
      entityFreq[ent] = (entityFreq[ent] || 0) + 1;
    }
  });

  // Sort proper nouns by frequency to find top entities
  const extractedEntities = Object.keys(entityFreq)
    .sort((a, b) => entityFreq[b] - entityFreq[a])
    .filter(ent => ent.length > 2)
    .slice(0, 6);

  // 2. Extract keywords (meaningful nouns/adjectives >= 5 characters)
  const wordMatches = combinedText.toLowerCase().match(/\b[a-z]{5,15}\b/g) || [];
  const wordFreq = {};
  wordMatches.forEach(word => {
    if (!STOPWORDS.has(word)) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  });

  // Sort keywords
  const topWords = Object.keys(wordFreq)
    .sort((a, b) => wordFreq[b] - wordFreq[a])
    .slice(0, 8);

  const extractedKeywords = [...new Set([
    ...extractedEntities,
    ...topWords.map(w => w.charAt(0).toUpperCase() + w.slice(1))
  ])].slice(0, 10);

  // 3. Narrative topics (first few keywords or general categories)
  const narrativeTopics = extractedKeywords.slice(0, 3);
  if (narrativeTopics.length === 0) {
    narrativeTopics.push("General Audit", "Narrative Intelligence");
  }

  // 4. Structured retrieval signals for EventRegistry
  const primaryEntity = extractedEntities[0] || extractedKeywords[0] || "News Audit";
  const secondEntity = extractedEntities[1] || extractedKeywords[1] || "";
  const retrievalQuery = secondEntity ? `"${primaryEntity}" AND "${secondEntity}"` : `"${primaryEntity}"`;
  
  const retrievalSignals = {
    retrievalQuery,
    primaryQueries: extractedEntities.slice(0, 2).map(e => `"${e}"`),
    searchTerms: extractedKeywords.slice(0, 5)
  };

  // 5. Keyword Relevance Scoring (Step 4)
  // Higher score for proper noun entities and higher frequency words
  const keywordRelevance = {};
  extractedKeywords.forEach((kw, index) => {
    let score = 85 - (index * 6); // base scale
    
    // Boost proper nouns (Entities)
    if (extractedEntities.includes(kw)) {
      score += 15;
    }
    
    // Clamp score
    keywordRelevance[kw] = Math.max(30, Math.min(100, score));
  });

  return {
    extractedKeywords,
    extractedEntities,
    narrativeTopics,
    retrievalSignals,
    keywordRelevance
  };
}

/**
 * Main Keyword & Entity Extraction Service call
 * Receives the clean summary and contextual narrative from Step 1.
 * Returns Step 5 Structured Output: { extractedKeywords, extractedEntities, narrativeTopics, retrievalSignals, keywordRelevance }
 */
async function extractKeywordsAndEntities(cleanSummary, contextualNarrative, metadata = {}) {
  if (!cleanSummary) {
    return {
      extractedKeywords: [],
      extractedEntities: [],
      narrativeTopics: ["General Analysis"],
      retrievalSignals: { retrievalQuery: "", primaryQueries: [], searchTerms: [] },
      keywordRelevance: {}
    };
  }

  const cacheKey = cache.generateKey('keyword_extract_v1', cleanSummary + contextualNarrative);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || groqKey === 'your_groq_api_key_here') {
    console.info('[keyword-engine] GROQ_API_KEY not configured. Triggering local deterministic extraction.');
    const localResult = localFallbackExtract(cleanSummary, contextualNarrative, metadata);
    cache.set(cacheKey, localResult);
    return localResult;
  }

  const prompt = [
    'You are a Senior Narrative Intelligence Specialist and Database Indexing Architect for TruthLens AI.',
    'Your goal is to analyze the provided professional summary and narrative context, and extract highly meaningful, retrieval-ready keywords and entities.',
    '',
    'EXTRACTION PARAMETERS:',
    '1. NARRATIVE EXTRACTION (Step 1): Extract keywords and entities ONLY from the clean summary and contextual narrative. Do NOT invent concepts outside this narrative flow.',
    '2. ADVANCED ENTITY EXTRACTION (Step 2): Correctly extract named entities into specific groups: People, Organizations, Political Parties, Countries, Locations, Events, Technologies, Institutions.',
    '3. STAGE FILTERS (Step 2 - REMOVE COMPLETELY): Never generate conversational filler words, weak nouns, or meaningless verbs. Do NOT extract: "this", "well", "thing", "getting", "know", "people", "video", "content", "clip", "audio".',
    '4. RETRIEVAL-READY KEYWORDS (Step 3): Select semantic keywords, narrative topics, and search signals optimized for database indexing and EventRegistry news retrieval. Keep phrases to high-precision nouns (e.g. "Alliance Politics" or "Electoral Commission" rather than "politics" or "elections").',
    '5. KEYWORD RELEVANCE SCORING (Step 4): Rank and score every keyword/entity by narrative importance, semantic relevance, retrieval usefulness, and contextual strength. Value must be an integer between 0 and 100.',
    '',
    'RETURN ONLY A JSON OBJECT (NO MARKDOWN WRAPPERS, NO BACKTICKS):',
    '{',
    '  "extractedKeywords": ["List of top 8-10 high-precision semantic narrative keywords and contextual search terms, sorted by relevance."],',
    '  "extractedEntities": ["List of all proper entities like people, organizations, parties, locations, events, technologies, institutions found in the text."],',
    '  "narrativeTopics": ["2-3 broad journalistic topics or categories that best describe this discussion."],',
    '  "retrievalSignals": {',
    '    "retrievalQuery": "A high-precision boolean query string for search engine search (e.g. \\"Congress\\" AND \\"Alliance Politics\\").",',
    '    "primaryQueries": ["2-3 separate exact phrases to query in database."],',
    '    "searchTerms": ["List of 4-6 simple search terms."]',
    '  },',
    '  "keywordRelevance": {',
    '    "keywordOrEntityName": 95,',
    '    "anotherKeyword": 80',
    '  }',
    '}',
    '',
    'CLEAN EXECUTIVE SUMMARY TO ANALYZE:',
    `"${cleanSummary}"`,
    '',
    'CONTEXTUAL NARRATIVE TO ANALYZE:',
    `"${contextualNarrative}"`
  ].join('\n');

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1, // Highly deterministic
        max_tokens: 600,
        response_format: { type: "json_object" }
      },
      headers: {
        'Authorization': 'Bearer ' + groqKey,
        'Content-Type': 'application/json',
      }
    }, { stage: 'keyword-extraction-engine' });

    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    // Apply strict filtering to returned keywords to double-ensure Step 2 quality bounds
    const filterNoise = (list) => {
      if (!Array.isArray(list)) return [];
      return list
        .map(item => String(item).trim())
        .filter(item => {
          const lower = item.toLowerCase();
          return item.length > 2 && !STOPWORDS.has(lower) && !/^\d+$/.test(item);
        });
    };

    const finalKeywords = filterNoise(parsed.extractedKeywords || []);
    const finalEntities = filterNoise(parsed.extractedEntities || []);
    const finalTopics = filterNoise(parsed.narrativeTopics || []);

    // Filter key relevance map
    const keywordRelevance = {};
    if (parsed.keywordRelevance && typeof parsed.keywordRelevance === 'object') {
      Object.keys(parsed.keywordRelevance).forEach(key => {
        if (!STOPWORDS.has(key.toLowerCase())) {
          keywordRelevance[key] = Math.max(10, Math.min(100, Number(parsed.keywordRelevance[key] || 70)));
        }
      });
    } else {
      // Fallback scoring if relevance missing
      finalKeywords.forEach((kw, idx) => {
        keywordRelevance[kw] = 90 - (idx * 5);
      });
    }

    const finalResult = {
      extractedKeywords: finalKeywords.slice(0, 10),
      extractedEntities: finalEntities.slice(0, 12),
      narrativeTopics: finalTopics.slice(0, 4),
      retrievalSignals: parsed.retrievalSignals || { retrievalQuery: "", primaryQueries: [], searchTerms: [] },
      keywordRelevance
    };

    cache.set(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.warn('[keyword-engine] Groq extraction failed. falling back to deterministic NLP:', err.message);
    const fallback = localFallbackExtract(cleanSummary, contextualNarrative, metadata);
    cache.set(cacheKey, fallback);
    return fallback;
  }
}

module.exports = {
  extractKeywordsAndEntities,
  localFallbackExtract
};
