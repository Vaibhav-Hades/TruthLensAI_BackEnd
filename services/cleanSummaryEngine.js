/**
 * cleanSummaryEngine.js
 * 
 * TruthLens AI Clean Summary Engine
 * 
 * Rebuilt and stabilized to generate highly accurate, human-readable,
 * context-preserving, and newsroom-grade summaries from video text.
 * 
 * TARGET FLOW:
 * Extracted Video Text -> Text Cleaning -> Semantic Chunking -> Narrative Understanding -> Contextual Summarization -> Final Humanized Summary
 */

const { robustFetch } = require('../utils/apiClient');
const cache = require('./cacheService');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama3-8b-8192';

// Stopwords and weak entities for deterministic local fallback
const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','it','its','this','that','was','are','be','been','have','has','had',
  'he','she','they','we','you','i','my','his','her','their','our','your',
  'so','as','if','by','from','up','about','into','than','then','when',
  'there','here','what','which','who','how','all','just','also','more',
  'not','no','do','did','does','will','would','could','should','can','may',
  'very','really','quite','rather','such','much','many','some','any','each',
  'every','both','few','most','other','another','same','own','only','even',
  'well','just','actually','basically','literally','really','very','ok','okay',
  'yeah','yes','right','like','uh','um','ah','hmm'
]);

const WEAK_ENTITIES = new Set([
  'video','content','media','report','story','article','post','page','site',
  'person','people','man','woman','men','women','thing','things','way','ways',
  'time','times','year','years','day','days','week','weeks','month','months',
  'place','area','region','country','city','town','world','part','side',
  'issue','issues','problem','problems','question','questions','matter',
  'fact','facts','data','information','news','update','statement','claim',
  'something','anything','someone','anyone','everything','nothing','speaker',
  'listener','audience','clip','audio','transcript','words','speech'
]);

/**
 * STEP 1: Text Cleaning
 * Cleans extracted text to remove timestamps, repeated phrases, malformed spacing, 
 * filler speech, transcript artifacts, and low-information noise.
 * Preserves: contextual meaning, factual discussions, sentence continuity, and narrative flow.
 */
function cleanText(text) {
  if (!text || typeof text !== 'string') return '';

  // 1. Normalize line endings and double spacing
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n');

  // 2. Remove timestamps, speaker IDs, and common meta-tags
  // Examples: [00:12], (12:34), 05:10 - End, Speaker 1:, [Applause], (laughter)
  cleaned = cleaned
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/gi, '')
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\)/gi, '')
    .replace(/^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+/gm, '')
    .replace(/^[A-Z][a-zA-Z0-9]+ \d+:/gm, '')
    .replace(/^[A-Z0-9\s_]{3,15}:/gm, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\([^)]+\)/g, '');

  // 3. Multilingual Filler Noise & Verbal Tics Reduction (English, Hindi, Telugu, Tamil)
  const fillers = [
    // English
    'um', 'uh', 'ah', 'err', 'mmm', 'hmm', 'uh-huh', 'basically', 'actually', 
    'literally', 'you know', 'sort of', 'kind of', 'anyway', 'so then', 'like', 'alright',
    'you see', 'I mean', 'to be honest', 'frankly', 'well', 'okay', 'yeah', 'yes',
    // Hindi/Hinglish
    'matlab', 'yaani', 'achha', 'varna', 'theek hai', 'dekhiye', 'suniye', 'samajhiye',
    'bilkul', 'shayad', 'kahin na kahin', 'ek tarah se', 'aap samajh rahe hain',
    // Telugu
    'ante', 'mari', 'ippudu', 'entante', 'vachhi', 'asalu', 'ade',
    // Tamil
    'appadi', 'vandhu', 'enna', 'theriyuma', 'irukku', 'saringa'
  ];
  
  const fillerRegex = new RegExp(`\\b(${fillers.join('|')})\\b`, 'gi');
  cleaned = cleaned.replace(fillerRegex, '');

  // 4. Word-level Deduplication (e.g. "the candidate candidate said")
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // 5. Sentence-level near-duplicate filtering
  const rawSentences = cleaned.split(/[.!?]\s+|\n/);
  const uniqueSentences = [];

  for (let i = 0; i < rawSentences.length; i++) {
    const s = rawSentences[i].trim();
    if (!s || s.length < 5) continue;

    // Jaccard-like check to avoid repeated stutter sentences or transcript loops
    const isRepeat = uniqueSentences.slice(-4).some(prev => {
      const pClean = prev.toLowerCase().replace(/[^\w]/g, '');
      const sClean = s.toLowerCase().replace(/[^\w]/g, '');
      if (pClean === sClean) return true;
      if (sClean.length > 15 && pClean.includes(sClean)) return true;
      if (pClean.length > 15 && sClean.includes(pClean)) return true;
      return false;
    });

    if (!isRepeat) {
      uniqueSentences.push(s);
    }
  }

  cleaned = uniqueSentences.join('. ');

  // 6. Final spacing, double periods, and trailing cleanups
  cleaned = cleaned
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();

  // Safety guard: If aggressive cleaning wipes out most of a substantive transcript,
  // revert to a basic clean to avoid discarding content.
  if (text.length > 300 && cleaned.length < text.length * 0.15) {
    return text.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim();
  }

  return cleaned;
}

/**
 * STEP 2: Simple Semantic Chunking
 * If the extracted text is long, splits into clean semantic chunks using overlap buffering.
 * Avoids complex recursive chunking models while preserving sentence boundaries and flow.
 */
function chunkText(text, maxChars = 3800, overlapSentences = 2) {
  if (!text) return [];

  // Match sentences ending in punctuation
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text];
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    currentChunk.push(sentence);
    currentLength += sentence.length;

    // Buffer limit reached or last sentence
    if (currentLength >= maxChars || i === sentences.length - 1) {
      chunks.push(currentChunk.join('').trim());

      if (i < sentences.length - 1) {
        // Carry forward the overlap sentences for context continuity
        const overlap = currentChunk.slice(-overlapSentences);
        currentChunk = [...overlap];
        currentLength = currentChunk.reduce((acc, s) => acc + s.length, 0);
      } else {
        currentChunk = [];
        currentLength = 0;
      }
    }
  }

  // If the last chunk is too small, merge it with the second-to-last
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.length < 800) {
      const popped = chunks.pop();
      chunks[chunks.length - 1] = (chunks[chunks.length - 1] + " " + popped).trim();
    }
  }

  return chunks;
}

/**
 * STEP 7 & Local Fallback: Deterministic NLP Summary Generator
 * Implements high-quality summary when Groq API key is missing or calls fail.
 * Strictly outputs the required JSON format: { cleanSummary, summaryConfidence, contextualNarrative, keyTopics }
 */
function generateFallbackSummary(cleanedText, metadata = {}) {
  const confidenceScore = Number(metadata.transcriptConfidence || 75);
  const audio = String(metadata.audioQuality || 'medium').toLowerCase();
  
  // Extract proper nouns for topics / entities
  const capitalizedPhrases = cleanedText.match(/\b[A-Z][a-zA-Z]{3,}(?:\s+[A-Z][a-zA-Z]{3,}){0,2}\b/g) || [];
  const entityFreq = {};
  capitalizedPhrases.forEach(p => {
    const lower = p.toLowerCase();
    if (!STOPWORDS.has(lower) && !WEAK_ENTITIES.has(lower)) {
      entityFreq[p] = (entityFreq[p] || 0) + 1;
    }
  });

  const sortedEntities = Object.keys(entityFreq)
    .sort((a, b) => entityFreq[b] - entityFreq[a])
    .slice(0, 5);

  // Extract general meaningful words
  const words = cleanedText.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
  const wordFreq = {};
  words.forEach(w => {
    if (!STOPWORDS.has(w) && !WEAK_ENTITIES.has(w)) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
  });

  const sortedKeywords = Object.keys(wordFreq)
    .sort((a, b) => wordFreq[b] - wordFreq[a])
    .slice(0, 6);

  const mainTopics = [...new Set([...sortedEntities, ...sortedKeywords.map(w => w.charAt(0).toUpperCase() + w.slice(1))])].slice(0, 5);
  
  // Tone detection
  const lowerText = cleanedText.toLowerCase();
  const positiveCount = (lowerText.match(/\b(good|great|success|benefit|improve|positive|safe|true|fact|proven|support|accurate|reliable|verified)\b/g) || []).length;
  const negativeCount = (lowerText.match(/\b(bad|wrong|false|fake|danger|risk|threat|mislead|manipulate|bias|lie|corrupt|attack|dispute)\b/g) || []).length;
  
  let tone = 'analytical and objective';
  if (negativeCount > positiveCount + 2) tone = 'critical and cautious';
  if (positiveCount > negativeCount + 2) tone = 'constructive and supportive';

  const topicsString = mainTopics.length > 0 ? mainTopics.join(', ') : 'general news topics';
  
  // Construct newsroom-grade deterministic summary
  const sentences = cleanedText
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 30);
  
  const coreStatement = sentences.slice(0, 2).join(' ') || cleanedText.slice(0, 250).trim();
  const cleanSummary = `This video discusses issues surrounding ${topicsString}. The speaker communicates this through a narrative focused on ${sortedKeywords.slice(0, 3).join(', ') || 'key semantic indicators'}.`;
  
  // Handle weak transcript confidence in local fallback
  let uncertaintyClause = '';
  let finalConfidence = confidenceScore;
  if (confidenceScore < 70 || audio === 'low' || cleanedText.length < 200) {
    uncertaintyClause = ' Due to limited audio fidelity or transcription clarity in the source file, certain narrative assertions carry minor ambiguity and require direct reference audit.';
    finalConfidence = Math.max(30, confidenceScore - 15);
  }

  const contextualNarrative = `The broadcast features a narrative with a predominantly ${tone} posture, primarily highlighting ${topicsString}.${uncertaintyClause} Investigative analysis has indexed these topics as primary search keys.`;

  return {
    cleanSummary,
    summaryConfidence: finalConfidence,
    contextualNarrative,
    keyTopics: mainTopics.length > 0 ? mainTopics : ['General Analysis', 'Media Review']
  };
}

/**
 * Core Service Call
 * Performs end-to-end clean summary generation.
 */
async function generateCleanSummary(rawTranscript, metadata = {}) {
  const cacheKey = cache.generateKey('clean_summary_v1', rawTranscript + JSON.stringify(metadata));
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // 1. STEP 1: Text Cleaning
  const cleanedText = cleanText(rawTranscript);
  
  if (!cleanedText || cleanedText.length < 20) {
    return {
      cleanSummary: "No substantive speech or text could be extracted from the video content for summarization.",
      summaryConfidence: 0,
      contextualNarrative: "The source audio yielded no high-confidence linguistic output. Full narrative context cannot be established.",
      keyTopics: ["Unresolved Audio"]
    };
  }

  // 2. STEP 2: Simple Semantic Chunking (if long)
  // We clean up and prepare a rich narrative map of chunks if long-form content is detected
  let narrativeMapContext = "";
  if (cleanedText.length > 4500) {
    const textChunks = chunkText(cleanedText, 3800, 2);
    // Standard summary limit for prompt
    narrativeMapContext = `The content was divided into ${textChunks.length} chronological sections for deep narrative analysis.`;
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || groqKey === 'your_groq_api_key_here') {
    console.info('[summary-engine] GROQ_API_KEY not configured or using default placeholder. Falling back to deterministic NLP.');
    const localResult = generateFallbackSummary(cleanedText, metadata);
    cache.set(cacheKey, localResult);
    return localResult;
  }

  // Determine speech/transcript quality to adjust LLM behavior (Step 7)
  const isWeakText = (metadata.transcriptConfidence && Number(metadata.transcriptConfidence) < 70) || 
                     (metadata.audioQuality === 'low') || 
                     (cleanedText.length < 300);

  // STEP 3 - 6: Generate through LLM (Groq)
  const prompt = [
    'You are a Senior Investigative Journalist and Chief Newsroom Editor for TruthLens AI.',
    'Your task is to analyze the following cleaned text extracted from a video, understand the core narrative, and generate exactly ONE professional, newsroom-grade summary object.',
    '',
    'ANALYSIS INSTRUCTIONS:',
    '1. NARRATIVE UNDERSTANDING (Step 3): Comprehend what the speaker is discussing, the political/social context, major events, factual statements, narrative relationships, and controversial discussions.',
    '2. IMPORTANT CONTENT PRIORITIZATION (Step 4): Prioritize factual discussions, major events, political topics, controversial claims, and narrative-driving details. Downplay or ignore greetings, conversational filler, stutters, and low-information talk.',
    '3. HUMANIZED SUMMARY (Step 5): Generate ONLY ONE clean, concise, human-written newsroom summary (2-3 sentences max). Ensure it sounds highly professional, authoritative, fluid, and natural. DO NOT use robotic phrasing, forensic/debug jargon (like "transcript", "confidence scores", "fallback", "semantic analysis"), or generic AI openings like "In this video...", "This transcript talks about...".',
    '4. ENTITY & CONTEXT PRESERVATION (Step 6): Accurately preserve people, locations, organizations, political parties, events, technologies, and relationships between them.',
    isWeakText ? '5. LOW-QUALITY TEXT HANDLING (Step 7): WARNING: The extracted transcript is of low quality or contains high conversational noise. Naturally preserve this uncertainty in your writing. Acknowledge what parts are unclear, do not invent details, and avoid hallucinating certainty.' : '',
    '',
    'RETURN ONLY A JSON OBJECT (NO MARKDOWN WRAPPERS, NO BACKTICKS):',
    '{',
    '  "cleanSummary": "A highly accurate, human-readable, fluid executive summary (2-3 sentences) capturing the core discussion and what happened.",',
    '  "summaryConfidence": 0-100 (a realistic confidence percentage based on factual density, source clarity, and overall completeness),',
    '  "contextualNarrative": "A professional analysis (3-4 sentences) outlining the underlying political/social context, speaker intent, controversy level, and the relationships between primary entities.",',
    '  "keyTopics": ["Up to 4 specific newsroom-grade narrative/event topics or categories"]',
    '}',
    '',
    'CLEANED SOURCE CONTENT TO ANALYZE:',
    cleanedText.slice(0, 8500),
    '',
    narrativeMapContext ? `ADDITIONAL SEGMENT CONTEXT:\n${narrativeMapContext}` : ''
  ].filter(Boolean).join('\n');

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15, // Low temperature for high deterministic accuracy and factual consistency
        max_tokens: 800,
        response_format: { type: "json_object" }
      },
      headers: {
        'Authorization': 'Bearer ' + groqKey,
        'Content-Type': 'application/json',
      }
    }, { stage: 'clean-summary-engine' });

    const raw = data.choices[0].message.content.trim();
    // Safe JSON parser block
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.cleanSummary) {
      throw new Error("Missing cleanSummary key in LLM response");
    }

    const finalResult = {
      cleanSummary: String(parsed.cleanSummary).trim().slice(0, 600),
      summaryConfidence: Math.max(10, Math.min(100, Number(parsed.summaryConfidence || 85))),
      contextualNarrative: String(parsed.contextualNarrative || '').trim().slice(0, 800),
      keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics.slice(0, 5).map(t => String(t).trim()) : ['General News']
    };

    cache.set(cacheKey, finalResult);
    return finalResult;

  } catch (err) {
    console.warn('[summary-engine] LLM generation failed. falling back to deterministic NLP:', err.message);
    const fallback = generateFallbackSummary(cleanedText, metadata);
    // Cache it so we don't repeat fail calls immediately
    cache.set(cacheKey, fallback);
    return fallback;
  }
}

module.exports = {
  cleanText,
  chunkText,
  generateCleanSummary,
  generateFallbackSummary
};
