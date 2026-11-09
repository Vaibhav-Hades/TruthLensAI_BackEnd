// translateController.js
// POST /api/translate  { payload: { key: string | (string|null)[] , ... }, targetLang: 'hi'|'te'|'ta'|'en' }
// -> { translated: <same shape, strings translated> }
//
// Generic by design: every string in the payload is translated, so new result fields never
// silently stay in English. Strings are flattened, translated in parallel batches with an
// index-addressed JSON contract (so order/length can be verified), and any string that fails
// falls back to its original text.

const axios = require('axios')
const cache = require('../services/cacheService')
const { GROQ_API_URL, GROQ_MODEL } = require('../config/llm')

const LANG_NAMES = { hi: 'Hindi (Devanagari script)', te: 'Telugu (Telugu script)', ta: 'Tamil (Tamil script)', en: 'English' }

const MAX_STRINGS = 300
const MAX_CHARS_PER_STRING = 1500
const BATCH_CHARS = 5000
const BATCH_ITEMS = 25

function flatten(payload) {
  const items = [] // { key, index|null, text }
  for (const [key, val] of Object.entries(payload)) {
    if (typeof val === 'string' && val.trim()) items.push({ key, index: null, text: val.slice(0, MAX_CHARS_PER_STRING) })
    else if (Array.isArray(val)) val.forEach((v, i) => { if (typeof v === 'string' && v.trim()) items.push({ key, index: i, text: v.slice(0, MAX_CHARS_PER_STRING) }) })
  }
  return items
}

function toBatches(items) {
  const batches = []
  let cur = [], chars = 0
  for (const it of items) {
    if (cur.length && (cur.length >= BATCH_ITEMS || chars + it.text.length > BATCH_CHARS)) { batches.push(cur); cur = []; chars = 0 }
    cur.push(it); chars += it.text.length
  }
  if (cur.length) batches.push(cur)
  return batches
}

async function translateBatch(batch, langName, key) {
  const input = {}
  batch.forEach((it, i) => { input[String(i)] = it.text })
  const prompt = [
    `Translate every value of the JSON object below into ${langName}.`,
    'Rules:',
    '- Return ONLY a JSON object with exactly the same keys ("0", "1", ...). Each value is the translation of the matching input value.',
    '- Keep proper nouns, organisation and publication names, numbers, dates, URLs and #hashtags unchanged (people and place names may be transliterated into the target script).',
    '- Preserve meaning, tone and factual precision. Do not add, omit or explain anything.',
    '- Use natural, fluent, standard written language, not a word-by-word translation.',
    '',
    JSON.stringify(input),
  ].join('\n')

  const response = await axios.post(
    GROQ_API_URL,
    { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 3500, response_format: { type: 'json_object' } },
    { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout: 30000 }
  )
  const raw = response.data.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(raw)
  return batch.map((it, i) => (typeof parsed[String(i)] === 'string' && parsed[String(i)].trim() ? parsed[String(i)] : it.text))
}

async function translateBatchWithRetry(batch, langName, key) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await translateBatch(batch, langName, key) } catch (e) {
      if (attempt === 1) {
        console.warn('[translate] batch failed, using original text:', e.message)
        return batch.map(it => it.text)
      }
    }
  }
}

const translate = async function(req, res, next) {
  try {
    const { payload, targetLang } = req.body || {}

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'payload object is required.', errorCode: 'INVALID_INPUT' })
    }
    if (targetLang && !LANG_NAMES[targetLang]) {
      return res.status(400).json({ error: 'Unsupported target language.', errorCode: 'UNSUPPORTED_LANGUAGE' })
    }
    if (!targetLang || targetLang === 'en') return res.status(200).json({ translated: payload })

    const key = process.env.GROQ_API_KEY
    if (!key || key === 'your_groq_api_key_here') return res.status(200).json({ translated: payload, degraded: 'no_api_key' })

    const items = flatten(payload)
    if (items.length > MAX_STRINGS) return res.status(413).json({ error: 'Too many strings to translate.', errorCode: 'PAYLOAD_TOO_LARGE' })

    // Per-string cache so repeated phrases (verdicts, source names) and re-opened results are instant.
    const out = items.map(it => cache.get(cache.generateKey('tx_v1', targetLang + '|' + it.text)))
    const todo = items.map((it, i) => ({ it, i })).filter(x => out[x.i] == null)

    const batches = toBatches(todo.map(x => x.it))
    let cursor = 0
    const results = await Promise.all(batches.map(async (b) => {
      const start = cursor; cursor += b.length
      return { start, texts: await translateBatchWithRetry(b, LANG_NAMES[targetLang], key) }
    }))
    for (const { start, texts } of results) {
      texts.forEach((txt, j) => {
        const { it, i } = todo[start + j]
        out[i] = txt
        if (txt !== it.text) cache.set(cache.generateKey('tx_v1', targetLang + '|' + it.text), txt, 1000 * 60 * 60 * 24 * 7)
      })
    }

    // Rebuild the same shape as the input.
    const translated = {}
    for (const [k, v] of Object.entries(payload)) translated[k] = Array.isArray(v) ? [...v] : v
    items.forEach((it, i) => {
      if (it.index === null) translated[it.key] = out[i]
      else translated[it.key][it.index] = out[i]
    })
    return res.status(200).json({ translated })
  } catch (err) {
    console.warn('[translate] failed, returning original:', err.message)
    return res.status(200).json({ translated: req.body?.payload || null, degraded: 'error' })
  }
}

module.exports = { translate, flatten }
