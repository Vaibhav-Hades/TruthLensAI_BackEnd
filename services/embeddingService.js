/**
 * embeddingService.js — local, deterministic text embeddings (no external API).
 *
 * v2 (replaces the 256-dim "sum of char codes mod 256" bucket scheme).
 * Why: the old scheme mapped each word to a bucket with `sum(charCode*(i+1)) % 256`.
 * That is a weak hash (many unrelated words share a bucket) over only 256 buckets, so
 * unrelated documents scored high cosine similarity. v2 uses signed feature hashing
 * (FNV-1a) over unigrams + bigrams with sublinear TF, in 512 dimensions:
 *   - far fewer collisions, and sign hashing makes the remaining ones cancel on average
 *   - bigrams add some word-order / phrase signal
 *   - light suffix stemming so "elections" ~ "election"
 *
 * IMPORTANT: this measures lexical/topical overlap only. It cannot tell whether a claim is
 * true, and the classifier never uses it to decide a verdict (see classificationService).
 */

const DIMS = 512

const STOPWORDS = new Set([
  'the','and','for','that','this','with','from','have','been','will','they','their','there','what','when',
  'which','your','about','into','more','also','just','some','than','then','were','would','could','should',
  'does','did','has','had','its','not','but','are','was','very','really','quite','such','much','many','most',
  'other','same','only','even','still','already','always','never','often','usually','said','says','after','over'
])

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

function tokenize(text) {
  // \p{L}\p{N} keeps non-Latin scripts (Hindi/Telugu/Tamil) instead of dropping them.
  const raw = (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  return raw.filter(w => w.length >= 3 && !STOPWORDS.has(w)).map(stem)
}

function embedText(text) {
  const vector = new Array(DIMS).fill(0)
  if (!text || typeof text !== 'string') return vector

  const tokens = tokenize(text)
  if (tokens.length === 0) return vector

  const tf = new Map()
  const add = (feat, w) => tf.set(feat, (tf.get(feat) || 0) + w)
  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i], 1)
    if (i + 1 < tokens.length) add(tokens[i] + '_' + tokens[i + 1], 0.7)
  }

  // Capitalised phrases (likely named entities) get extra weight.
  const entities = text.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,}){0,2}\b/g) || []
  for (const e of entities) for (const t of tokenize(e)) if (tf.has(t)) tf.set(t, tf.get(t) + 0.5)

  for (const [feat, count] of tf) {
    const h = fnv1a(feat)
    const idx = h % DIMS
    const sign = (fnv1a('s' + feat) & 1) ? 1 : -1
    vector[idx] += sign * (1 + Math.log(count))
  }

  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0))
  return norm > 0 ? vector.map(v => v / norm) : vector
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

// Kept async for backwards compatibility with existing callers.
const generateEmbedding = async function(text) {
  try { return embedText(text) } catch (err) {
    console.error('[embedding] Error generating embedding:', err.message)
    return new Array(DIMS).fill(0)
  }
}

module.exports = { generateEmbedding, embedText, cosineSimilarity, tokenize, DIMS }
