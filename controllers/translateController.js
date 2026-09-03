// translateController.js
// Translates a structured analysis payload to the target language via Groq.
// Handles all dynamic AI-generated fields including narrative intelligence,
// article titles/summaries, deepfake/visual reasoning, and verdict labels.
//
// Large payloads are split into two Groq calls (core + narrative) to stay
// within the token limit and avoid truncated translations.

const axios = require('axios')

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.1-8b-instant'

const LANG_NAMES = { hi: 'Hindi', te: 'Telugu', ta: 'Tamil', en: 'English' }

// ── Groq call helper ──────────────────────────────────────────────────────────
async function groqTranslate(toTranslate, langName, key) {
  if (!Object.keys(toTranslate).length) return {}

  const prompt = [
    `You are a professional translator. Translate the following JSON fields to ${langName}.`,
    'Rules:',
    '- Return ONLY valid JSON with the exact same keys and array lengths.',
    '- Preserve array length exactly — translate each element, keep nulls as null.',
    '- Do NOT translate proper nouns, URLs, numbers, organisation names, or source names.',
    '- Preserve the original meaning, tone, and factual accuracy.',
    '- No explanations, no markdown, no extra text outside the JSON.',
    '',
    'Input JSON:',
    JSON.stringify(toTranslate),
  ].join('\n')

  const response = await axios.post(
    GROQ_API_URL,
    { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 2400 },
    { headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout: 20000 }
  )

  const raw     = response.data.choices[0].message.content.trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(cleaned)
}

// ── Merge translated chunk back, preserving nulls for skipped fields ──────────
function mergeArrayField(payload, translated, key) {
  return (payload[key] || []).map((orig, i) =>
    orig === null ? null : (translated[key]?.[i] || orig)
  )
}

// ── Build fallback (original values) ─────────────────────────────────────────
function buildFallback(payload) {
  const ARRAY_KEYS = [
    'reasoning_points','claims','claim_reasonings','sources',
    'article_titles','article_summaries','article_match_reasons',
    'supporting_titles','supporting_summaries','supporting_match_reasons',
    'contradicting_titles','contradicting_summaries','contradicting_match_reasons',
  ]
  const result = {}
  for (const k of ARRAY_KEYS) result[k] = (payload[k] || []).map(v => v)
  const SCALAR_KEYS = [
    'summary','meaning','explanation','verdict_label','fetch_diagnostic',
    'narrative_reasoning','consensus_summary','visual_reasoning','deepfake_reasoning','chat_response',
  ]
  for (const k of SCALAR_KEYS) result[k] = payload[k] || null
  return result
}

// ── POST /api/translate ───────────────────────────────────────────────────────
const translate = async function(req, res, next) {
  try {
    const { payload, targetLang } = req.body

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload object is required.' })
    }
    if (!targetLang || targetLang === 'en') {
      return res.status(200).json({ translated: buildFallback(payload) })
    }

    const langName = LANG_NAMES[targetLang]
    if (!langName) return res.status(400).json({ error: 'Unsupported target language.' })

    const key = process.env.GROQ_API_KEY
    if (!key || key === 'your_groq_api_key_here') {
      return res.status(200).json({ translated: buildFallback(payload) })
    }

    // ── Chunk 1: Core analysis fields ─────────────────────────────────────────
    const coreChunk = {}
    const CORE_SCALARS = ['summary','meaning','explanation','verdict_label','fetch_diagnostic','consensus_summary','visual_reasoning','deepfake_reasoning','chat_response']
    for (const k of CORE_SCALARS) { if (payload[k]) coreChunk[k] = String(payload[k]).slice(0, 2000) }

    const coreArrays = ['reasoning_points','claims','claim_reasonings','sources']
    for (const k of coreArrays) {
      const arr = (payload[k] || []).filter(Boolean)
      if (arr.length) coreChunk[k] = arr.map(v => String(v).slice(0, 300))
    }

    // ── Chunk 2: Narrative intelligence fields ────────────────────────────────
    const narrativeChunk = {}
    if (payload.narrative_reasoning) narrativeChunk.narrative_reasoning = String(payload.narrative_reasoning).slice(0, 500)

    const narrativeArrays = [
      'article_titles','article_summaries','article_match_reasons',
      'supporting_titles','supporting_summaries','supporting_match_reasons',
      'contradicting_titles','contradicting_summaries','contradicting_match_reasons',
    ]
    for (const k of narrativeArrays) {
      const arr = (payload[k] || []).filter(Boolean)
      if (arr.length) narrativeChunk[k] = arr.map(v => String(v).slice(0, 300))
    }

    // Nothing to translate
    if (!Object.keys(coreChunk).length && !Object.keys(narrativeChunk).length) {
      return res.status(200).json({ translated: buildFallback(payload) })
    }

    // Run both chunks in parallel
    const [coreT, narrativeT] = await Promise.all([
      Object.keys(coreChunk).length      ? groqTranslate(coreChunk,      langName, key) : Promise.resolve({}),
      Object.keys(narrativeChunk).length ? groqTranslate(narrativeChunk, langName, key) : Promise.resolve({}),
    ])

    // ── Merge results ─────────────────────────────────────────────────────────
    const translated = {
      // Core scalars
      summary:            coreT.summary            || payload.summary            || null,
      meaning:            coreT.meaning            || payload.meaning            || null,
      explanation:        coreT.explanation        || payload.explanation        || null,
      verdict_label:      coreT.verdict_label      || payload.verdict_label      || null,
      fetch_diagnostic:   coreT.fetch_diagnostic   || payload.fetch_diagnostic   || null,
      consensus_summary:  coreT.consensus_summary  || payload.consensus_summary  || null,
      visual_reasoning:   coreT.visual_reasoning   || payload.visual_reasoning   || null,
      deepfake_reasoning: coreT.deepfake_reasoning || payload.deepfake_reasoning || null,
      chat_response:      coreT.chat_response      || payload.chat_response      || null,

      // Core arrays
      reasoning_points: mergeArrayField(payload, coreT, 'reasoning_points'),
      claims:           mergeArrayField(payload, coreT, 'claims'),
      claim_reasonings: mergeArrayField(payload, coreT, 'claim_reasonings'),
      sources:          mergeArrayField(payload, coreT, 'sources'),

      // Narrative scalar
      narrative_reasoning: narrativeT.narrative_reasoning || payload.narrative_reasoning || null,

      // Narrative arrays
      article_titles:              mergeArrayField(payload, narrativeT, 'article_titles'),
      article_summaries:           mergeArrayField(payload, narrativeT, 'article_summaries'),
      article_match_reasons:       mergeArrayField(payload, narrativeT, 'article_match_reasons'),
      supporting_titles:           mergeArrayField(payload, narrativeT, 'supporting_titles'),
      supporting_summaries:        mergeArrayField(payload, narrativeT, 'supporting_summaries'),
      supporting_match_reasons:    mergeArrayField(payload, narrativeT, 'supporting_match_reasons'),
      contradicting_titles:        mergeArrayField(payload, narrativeT, 'contradicting_titles'),
      contradicting_summaries:     mergeArrayField(payload, narrativeT, 'contradicting_summaries'),
      contradicting_match_reasons: mergeArrayField(payload, narrativeT, 'contradicting_match_reasons'),
    }

    return res.status(200).json({ translated })

  } catch (err) {
    console.warn('[translate] Groq call failed, returning original:', err.message)
    const fallback = req.body?.payload ? buildFallback(req.body.payload) : null
    return res.status(200).json({ translated: fallback })
  }
}

module.exports = { translate }
