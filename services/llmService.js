const { robustFetch } = require('../utils/apiClient');
const cache = require('./cacheService');
const axios = require('axios')

// ── Local NLP fallback (used when Groq is unavailable) ────────────────────────

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','it','its','this','that','was','are','be','been','have','has','had',
  'he','she','they','we','you','i','my','his','her','their','our','your',
  'so','as','if','by','from','up','about','into','than','then','when',
  'there','here','what','which','who','how','all','just','also','more',
  'not','no','do','did','does','will','would','could','should','can','may',
  'very','really','quite','rather','such','much','many','some','any','each',
  'every','both','few','most','other','another','same','own','only','even',
  'well','just','actually','basically','literally','really','very'
])

const WEAK_ENTITIES = new Set([
  'video','content','media','report','story','article','post','page','site',
  'person','people','man','woman','men','women','thing','things','way','ways',
  'time','times','year','years','day','days','week','weeks','month','months',
  'place','area','region','country','city','town','world','part','side',
  'issue','issues','problem','problems','question','questions','matter',
  'fact','facts','data','information','news','update','statement','claim',
  'something','anything','someone','anyone','everything','nothing'
])

const splitSentences = function(text) {
  return text
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map(function(s) { return s.trim() })
    .filter(function(s) { return s.length > 25 })
}

const extractKeywords = function(text, topN) {
  var freq = {}
  // Extract proper nouns and potential entities (Cap Words)
  var phrases = text.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,}){0,2}\b/g) || []
  phrases.forEach(function(p) {
    var lower = p.toLowerCase()
    if (!STOPWORDS.has(lower) && !WEAK_ENTITIES.has(lower)) {
      freq[p] = (freq[p] || 0) + 4
    }
  })
  
  // Extract common meaningful words
  var words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || []
  words.forEach(function(w) {
    if (!STOPWORDS.has(w) && !WEAK_ENTITIES.has(w)) {
      freq[w] = (freq[w] || 0) + 1
    }
  })
  
  return Object.keys(freq)
    .sort(function(a, b) { return freq[b] - freq[a] })
    .filter(function(k) { return freq[k] >= 2 })
    .slice(0, topN || 10)
}

const detectTone = function(text) {
  var lower = text.toLowerCase()
  var positiveHits = (lower.match(/\b(good|great|success|benefit|improve|positive|safe|true|fact|proven|support|confirm|accurate|reliable|verified|breakthrough|milestone)\b/g) || []).length
  var negativeHits = (lower.match(/\b(bad|wrong|false|fake|danger|risk|threat|mislead|manipulate|bias|lie|corrupt|attack|dispute|contradict|debunk|alarming|warning)\b/g) || []).length
  if (negativeHits > positiveHits + 2) return 'critical/cautionary'
  if (positiveHits > negativeHits + 2) return 'positive/constructive'
  return 'analytical/neutral'
}

const localFallback = function(transcript) {
  var sentences   = splitSentences(transcript)
  var summary     = sentences.slice(0, 3).join(' ') || transcript.slice(0, 400).trim()
  var keywords    = extractKeywords(transcript, 10)
  var tone        = detectTone(transcript)
  var topicPhrase = keywords.length > 0 ? keywords.slice(0, 6).join(', ') : 'general topics'
  
  var entities = keywords.filter(k => /^[A-Z]/.test(k)).slice(0, 5)
  
  var meaning = 'This content focuses on ' + topicPhrase + '. The analysis suggests a ' + tone + ' tone.'
  
  var verdict_label = 'Questionable'
  var explanation = 'Content processed via local linguistic analysis. Keywords: ' + topicPhrase + '.'
  var reasoning_points = [
    'Tone identified as ' + tone,
    'Key subjects: ' + topicPhrase,
    'Factual verification pending external API connection'
  ]

  return { summary, meaning, claims: [], entities, keywords, explanation, reasoning_points, verdict_label }
}

// ── Groq LLM (primary) ────────────────────────────────────────────────────────

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.1-8b-instant'

const summarizeWithGroq = async function(transcript) {
  const cacheKey = cache.generateKey('summary_v3', transcript);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set')

  const text = transcript.slice(0, 9500)

  const prompt = [
    'You are a Senior Investigative Journalist and News Analyst. Your goal is to provide a highly accurate, human-readable, and contextual analysis of the provided content. Avoid all technical jargon, robotic phrasing, or debug-style terminology.',
    '',
    'ANALYSIS REQUIREMENTS:',
    '1. SUMMARY: Write a professional, fluid summary (2-3 sentences) that captures the core narrative, central discussion points, and social/political context. It should sound human-written, not like a machine-generated list.',
    '2. INTENT: Explain the underlying meaning or intent of the speaker/content naturally.',
    '3. EXPLANATION: Provide a clear, professional assessment of the content\'s credibility and the evidence presented.',
    '4. REASONING: List 3-4 natural reasoning points that explain why a certain verdict was reached, focusing on factual consistency and source alignment.',
    '',
    'CLAIM EXTRACTION:',
    '- Extract 2-4 specific, verifiable factual assertions.',
    '- Each claim must be a complete, standalone sentence with named entities (people, places, data).',
    '- Focus on claims that are central to the content\'s message.',
    '',
    'OUTPUT FORMAT (STRICT JSON ONLY):',
    '{',
    '  "summary": "Professional and contextual narrative overview",',
    '  "meaning": "Natural explanation of intent and core message",',
    '  "entities": ["Named people, organizations, locations"],',
    '  "keywords": ["Journalistic keywords for verification search"],',
    '  "claims": [',
    '    {',
    '      "claim": "The specific factual assertion",',
    '      "category": "Political|Economic|Geopolitical|Scientific|Security|Public Interest",',
    '      "confidence": 0-100,',
    '      "entities": ["Entities in this claim"],',
    '      "narrativeImportance": 0-100,',
    '      "checkworthy": true',
    '    }',
    '  ],',
    '  "explanation": "Clear, evidence-driven credibility assessment",',
    '  "reasoning_points": ["Point 1 about evidence", "Point 2 about context", "..."],',
    '  "verdict_label": "Likely True | Questionable | Misleading | False"',
    '}',
    '',
    'CONTENT TO ANALYZE:',
    text,
  ].join('\n')

  const data = await robustFetch({
    method: 'post',
    url: GROQ_API_URL,
    data: {
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1200,
    },
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
    }
  }, { stage: 'groq-summary' });

  const raw = data.choices[0].message.content.trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned)

  if (!parsed.summary || !parsed.meaning) throw new Error('Incomplete Groq response')

  const VALID_VERDICTS = ['Likely True', 'Questionable', 'Misleading', 'False']
  const verdict_label = VALID_VERDICTS.includes(parsed.verdict_label)
    ? parsed.verdict_label
    : 'Questionable'

  const result = {
    summary: String(parsed.summary).slice(0, 500),
    meaning: String(parsed.meaning).slice(0, 500),
    explanation: String(parsed.explanation || '').slice(0, 600),
    reasoning_points: Array.isArray(parsed.reasoning_points)
      ? parsed.reasoning_points.slice(0, 5).map(p => String(p).slice(0, 300))
      : [],
    verdict_label,
    entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 8) : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 10) : [],
    claims: Array.isArray(parsed.claims)
      ? parsed.claims.slice(0, 4).map(c => ({
          claim: String(c.claim || '').slice(0, 300),
          category: String(c.category || 'General'),
          confidence: Number(c.confidence || 70),
          entities: Array.isArray(c.entities) ? c.entities.slice(0, 3) : [],
          narrativeImportance: Number(c.narrativeImportance || 50),
          checkworthy: !!c.checkworthy,
        }))
      : [],
  };

  cache.set(cacheKey, result);
  return result;
}

/**
 * Generates summary and meaning from transcript.
 * Primary: Groq LLaMA3 (fast, free tier).
 * Fallback: local NLP (always works, no API needed).
 */
const summarizeAndExtract = async function(transcript) {
  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here') {
    try {
      return await summarizeWithGroq(transcript)
    } catch (err) {
      console.warn('Groq LLM failed, falling back to local NLP:', err.message)
    }
  }
  return localFallback(transcript)
}

/**
 * Fast first pass: extract only raw claim strings from the transcript.
 * Used by the verification pipeline so claim checks can start immediately.
 * Falls back to empty array if Groq is unavailable.
 */
const extractClaimsOnly = async function(transcript) {
  const key = process.env.GROQ_API_KEY
  if (!key || key === 'your_groq_api_key_here') return []

  const text = transcript.slice(0, 4000)

  const prompt = [
    'You are an expert fact-checker. Extract 2-4 HIGH-QUALITY verifiable claims from this content.',
    'Return ONLY a JSON array of strings (no markdown):',
    '["claim 1", "claim 2"]',
    '',
    'CLAIM QUALITY REQUIREMENTS:',
    '1. Must be a specific, concrete factual assertion',
    '2. Must contain named entities: people, organizations, places, dates, or statistics',
    '3. Must be independently verifiable against Wikipedia, news archives, or official sources',
    '4. Must be a complete, standalone sentence',
    '5. Must be meaningful and substantive (not trivial)',
    '',
    'MANDATORY ELEMENTS (at least one):',
    '- Named person: "Elon Musk", "Joe Biden", "Narendra Modi"',
    '- Organization: "NASA", "WHO", "Congress", "BJP"',
    '- Location: "Gaza", "Ukraine", "New Delhi"',
    '- Date/time: "July 2023", "December 2020"',
    '- Statistic: "1.4 billion", "50%", "$100 million"',
    '',
    'REJECT (do not extract):',
    '✗ Opinions: "This policy is bad"',
    '✗ Vague claims: "Many experts say", "Studies show"',
    '✗ Emotional statements: "This is outrageous"',
    '✗ Generic facts: "The sky is blue"',
    '✗ Questions or hypotheticals',
    '✗ Incomplete fragments',
    '',
    'EXTRACT ONLY:',
    '✓ Political claims with named actors',
    '✓ Historical events with dates',
    '✓ Scientific/medical claims with specifics',
    '✓ Economic data with numbers',
    '✓ Controversial or disputed assertions',
    '',
    'If content lacks verifiable claims, return empty array [].',
    '',
    'Content:',
    text,
  ].join('\n')

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model:       GROQ_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens:  350,
      },
      {
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type':  'application/json',
        },
        timeout: 10000,
      }
    )

    const raw     = response.data.choices[0].message.content.trim()
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed  = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(c => typeof c === 'string' && c.trim().length > 15)
      .slice(0, 4)
      .map(c => c.trim())
  } catch (err) {
    console.warn('extractClaimsOnly failed:', err.message)
    return []
  }
}

/**
 * Advanced Investigative Chat Engine.
 * Fully pipeline-aware, multilingual, and conversational.
 */
const chatWithGroq = async function({ question, context, history, language, sarvamActive = false }) {
  const key = process.env.GROQ_API_KEY
  if (!key || key === 'your_groq_api_key_here') throw new Error('GROQ_API_KEY not configured')

  const langMap = { hi: 'Hindi', te: 'Telugu', ta: 'Tamil', en: 'English' }
  const targetLang = langMap[language] || 'English'

  // Construct a dense forensic context for the LLM
  const forensicCtx = {
    verdict: context.verdict_label || context.verdict || 'Unverified',
    score: context.truthScore || context.credibilityScore || 0,
    summary: context.summary || '',
    claims: (context.claims || []).map(c => `[${c.category}] ${c.claim}`),
    evidence: (context.matchedSources || []).map(s => `${s.source || s.label} (Alignment: ${s.narrativeAlignment || s.similarity || 0}%)`),
    narrative: context.reasoning || context.semanticAnalysis?.reasoning || context.liveNarrativeAnalysis?.reasoning || '',
    articles: (context.liveNarrativeAnalysis?.articleSummaries || []).map(a => `[${a.source}] ${a.title} - Stance: ${a.stance || 'Neutral'}`),
    contradictions: (context.liveNarrativeAnalysis?.contradictingSources || []).map(a => a.source),
    transcriptSource: context.pipeline?.metadata?.transcriptSource || 'Native',
    audioQuality: context.pipeline?.metadata?.audioQuality || 'High',
    fallbackUsed: context.pipeline?.metadata?.fallbackUsed || false
  }

  const persona = sarvamActive 
    ? 'TruthLens Investigative Lead (Sarvam AI Enhanced). You are an expert in Indian news verification and multilingual reporting.'
    : 'TruthLens Senior Investigative Analyst. You are an expert in news verification and narrative intelligence.'

  const prompt = [
    `Persona: Senior Investigative Analyst for TruthLens AI.`,
    `Task: Explain the investigation results clearly and authoritatively based ONLY on the data provided.`,
    sarvamActive ? `Language: Respond in ${targetLang}. Use professional and natural phrasing.` : `Language: Professional English.`,
    ``,
    `INVESTIGATION DATA:`,
    `- Verdict: ${forensicCtx.verdict} (Confidence: ${forensicCtx.score}%)`,
    `- Summary: ${forensicCtx.summary}`,
    `- Evidence: ${forensicCtx.evidence.slice(0, 3).join(', ')}`,
    `- Narrative Reasoning: ${forensicCtx.narrative}`,
    `- Contradicting Reports: ${forensicCtx.contradictions.join(', ') || 'None'}`,
    ``,
    `INVESTIGATIVE GUIDELINES:`,
    `1. START DIRECTLY with the answer. NO robotic preambles like "Based on the data..."`,
    `2. Use a "Professional Newsroom" style: authoritative, fact-based, and human-readable.`,
    `3. Focus exclusively on the REAL evidence matched in the investigation.`,
    `4. If evidence is limited, be transparent about the coverage.`,
    `5. Use bullet points for summarizing key evidence if it helps clarity.`,
    ``,
    `USER QUESTION: ${question}`
  ].filter(Boolean).join('\n')

  try {
    const messages = [
      { role: 'system', content: 'You are a senior investigative analyst. You speak naturally, avoid robotic jargon, and provide evidence-based insights.' },
      ...history.slice(-6), 
      { role: 'user', content: prompt }
    ]

    const response = await axios.post(
      GROQ_API_URL,
      {
        model:       GROQ_MODEL,
        messages,
        temperature: 0.4, // Balanced for creativity vs precision
        max_tokens:  800,
      },
      {
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type':  'application/json',
        },
        timeout: 15000,
      }
    )

    return response.data.choices[0].message.content.trim()
  } catch (err) {
    console.error('chatWithGroq failed:', err.message)
    throw err
  }
}

module.exports = { summarizeAndExtract, extractClaimsOnly, chatWithGroq, localFallback }
