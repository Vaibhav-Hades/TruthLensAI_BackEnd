// visualAnalysisService.js
// Analyzes YouTube video titles and thumbnails for clickbait, manipulation,
// and sensationalism using Groq LLM reasoning.
//
// No vision API required — uses:
//   1. YouTube oEmbed API (free, no key) to get title + thumbnail URL
//   2. Groq text reasoning to analyze title patterns and thumbnail URL context
//
// Falls back gracefully — never blocks the main analysis pipeline.

const axios = require('axios')

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.1-8b-instant'

// ── Fetch YouTube metadata via oEmbed (free, no API key) ─────────────────────

async function fetchYouTubeMetadata(videoUrl) {
  try {
    const res = await axios.get('https://www.youtube.com/oembed', {
      params: { url: videoUrl, format: 'json' },
      timeout: 6000,
    })
    return {
      title:         res.data.title         || '',
      authorName:    res.data.author_name   || '',
      thumbnailUrl:  res.data.thumbnail_url || '',
    }
  } catch {
    return null
  }
}

// ── Extract video ID for thumbnail URL construction ───────────────────────────

function extractVideoId(url) {
  if (!url) return null
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// ── Analyze title + thumbnail with Groq ───────────────────────────────────────

async function analyzeWithGroq(title, authorName, thumbnailUrl, videoUrl) {
  const key = process.env.GROQ_API_KEY
  if (!key || key === 'your_groq_api_key_here') return null

  const videoId = extractVideoId(videoUrl)
  const thumbContext = thumbnailUrl
    ? `Thumbnail URL: ${thumbnailUrl} (YouTube video ID: ${videoId || 'unknown'})`
    : 'No thumbnail available.'

  const prompt = [
    'You are a media literacy expert analyzing a YouTube video for visual misinformation signals.',
    'Analyze the video title and thumbnail URL context for clickbait, manipulation, and sensationalism.',
    'Respond with ONLY valid JSON (no markdown, no extra text):',
    '{',
    '  "clickbait_score": <integer 0-100, where 0=not clickbait, 100=extreme clickbait>,',
    '  "manipulation_indicators": ["<indicator 1>", "<indicator 2>"],',
    '  "thumbnail_text_detected": "<any text visible in thumbnail based on URL patterns, or empty string>",',
    '  "reasoning": "<2-3 sentence explanation of visual credibility assessment>",',
    '  "credibility_penalty": <integer 0-25, penalty to subtract from truth score>',
    '}',
    '',
    'SCORING GUIDE for clickbait_score:',
    '  0-20:  Neutral, factual title. No manipulation detected.',
    '  21-40: Mildly sensational. Some emotional language.',
    '  41-60: Moderately clickbait. Exaggerated claims or emotional hooks.',
    '  61-80: High clickbait. Fear-inducing, shocking, or misleading framing.',
    '  81-100: Extreme clickbait. Fake urgency, ALL CAPS, conspiracy framing.',
    '',
    'CREDIBILITY PENALTY GUIDE:',
    '  0:     No penalty (neutral/factual)',
    '  1-8:   Minor penalty (mildly sensational)',
    '  9-15:  Moderate penalty (clickbait patterns)',
    '  16-25: High penalty (extreme manipulation or fake news patterns)',
    '',
    'MANIPULATION INDICATORS to detect (list only those present):',
    '  - ALL_CAPS_TITLE',
    '  - EXCESSIVE_PUNCTUATION (!!!, ???)',
    '  - FEAR_LANGUAGE (shocking, terrifying, exposed, destroyed)',
    '  - FAKE_URGENCY (breaking, urgent, must watch)',
    '  - CONSPIRACY_FRAMING (they dont want you to know, hidden truth)',
    '  - EXAGGERATED_CLAIM (best ever, worst ever, changes everything)',
    '  - EMOTIONAL_MANIPULATION (heartbreaking, outrageous)',
    '  - MISLEADING_THUMBNAIL_PATTERN (reaction face, red arrows, fake celebrity)',
    '',
    `Video Title: "${title}"`,
    `Channel: "${authorName}"`,
    thumbContext,
  ].join('\n')

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model:       GROQ_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens:  400,
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

    return {
      clickbaitScore:         Math.min(100, Math.max(0, Number(parsed.clickbait_score)  || 0)),
      manipulationIndicators: Array.isArray(parsed.manipulation_indicators)
        ? parsed.manipulation_indicators.slice(0, 6).map(s => String(s))
        : [],
      thumbnailTextDetected:  String(parsed.thumbnail_text_detected || '').slice(0, 200),
      reasoning:              String(parsed.reasoning || '').slice(0, 500),
      credibilityPenalty:     Math.min(25, Math.max(0, Number(parsed.credibility_penalty) || 0)),
    }
  } catch (err) {
    console.warn('[visualAnalysis] Groq analysis failed:', err.message)
    return null
  }
}

// ── Local heuristic fallback (no Groq key needed) ─────────────────────────────

function localHeuristicAnalysis(title) {
  if (!title) return null

  const t = title.toUpperCase()
  const indicators = []
  let score = 0

  if (t === title && title.length > 10 && /[A-Z]{5,}/.test(title)) {
    indicators.push('ALL_CAPS_TITLE'); score += 20
  }
  if (/[!?]{2,}/.test(title)) {
    indicators.push('EXCESSIVE_PUNCTUATION'); score += 15
  }
  if (/\b(shocking|terrifying|exposed|destroyed|obliterated|annihilated)\b/i.test(title)) {
    indicators.push('FEAR_LANGUAGE'); score += 20
  }
  if (/\b(breaking|urgent|must.?watch|you.?need.?to.?see)\b/i.test(title)) {
    indicators.push('FAKE_URGENCY'); score += 15
  }
  if (/\b(they don.?t want|hidden truth|what they.?re hiding|secret|cover.?up)\b/i.test(title)) {
    indicators.push('CONSPIRACY_FRAMING'); score += 25
  }
  if (/\b(best ever|worst ever|changes everything|never seen before|unbelievable)\b/i.test(title)) {
    indicators.push('EXAGGERATED_CLAIM'); score += 15
  }
  if (/\b(heartbreaking|outrageous|disgusting|infuriating)\b/i.test(title)) {
    indicators.push('EMOTIONAL_MANIPULATION'); score += 10
  }

  score = Math.min(100, score)
  const penalty = Math.round(score * 0.2)  // max 20 from heuristic

  return {
    clickbaitScore:         score,
    manipulationIndicators: indicators,
    thumbnailTextDetected:  '',
    reasoning:              indicators.length > 0
      ? `Title analysis detected: ${indicators.join(', ')}. These patterns are commonly associated with clickbait and sensational content.`
      : 'No significant clickbait patterns detected in the title.',
    credibilityPenalty: penalty,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Analyzes a YouTube video's visual presentation for misinformation signals.
 * Always returns a result — never throws (fails silently).
 *
 * @param {string} videoUrl
 * @returns {{
 *   title: string,
 *   thumbnailUrl: string,
 *   clickbaitScore: number,
 *   manipulationIndicators: string[],
 *   thumbnailTextDetected: string,
 *   reasoning: string,
 *   credibilityPenalty: number,
 *   analysisSource: 'groq' | 'heuristic' | 'unavailable'
 * }}
 */
async function analyzeVisuals(videoUrl) {
  const EMPTY = {
    title:                  '',
    thumbnailUrl:           '',
    clickbaitScore:         0,
    manipulationIndicators: [],
    thumbnailTextDetected:  '',
    reasoning:              '',
    credibilityPenalty:     0,
    analysisSource:         'unavailable',
  }

  try {
    // Fetch metadata
    const meta = await fetchYouTubeMetadata(videoUrl)
    if (!meta || !meta.title) return EMPTY

    const thumbnailUrl = meta.thumbnailUrl
      || (extractVideoId(videoUrl)
        ? `https://img.youtube.com/vi/${extractVideoId(videoUrl)}/maxresdefault.jpg`
        : '')

    // Try Groq first, fall back to local heuristic
    const groqResult = await analyzeWithGroq(meta.title, meta.authorName, thumbnailUrl, videoUrl)

    if (groqResult) {
      return {
        title:        meta.title,
        thumbnailUrl,
        ...groqResult,
        analysisSource: 'groq',
      }
    }

    // Local heuristic fallback
    const heuristic = localHeuristicAnalysis(meta.title)
    if (heuristic) {
      return {
        title:        meta.title,
        thumbnailUrl,
        ...heuristic,
        analysisSource: 'heuristic',
      }
    }

    return { ...EMPTY, title: meta.title, thumbnailUrl }
  } catch (err) {
    console.warn('[visualAnalysis] analyzeVisuals failed silently:', err.message)
    return EMPTY
  }
}

module.exports = { analyzeVisuals }
