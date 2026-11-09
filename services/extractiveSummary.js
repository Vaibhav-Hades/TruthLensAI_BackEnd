/**
 * extractiveSummary.js — deterministic, faithful fallback summariser (no LLM).
 *
 * Instead of a template ("This video discusses issues surrounding X"), it selects the most
 * informative sentences that actually exist in the source: scored by term frequency, named
 * entities, numbers/dates and position, then returned in original order. Nothing is invented.
 */

const STOP = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','it','its','this','that','was','are','be','been','have','has','had','he','she','they','we','you','i','my','his','her','their','our','your','so','as','if','by','from','up','about','into','than','then','when','there','here','what','which','who','how','all','just','also','more','not','no','do','did','does','will','would','could','should','can','may','said','says'])

function splitSentences(text) {
  // Split only on terminal punctuation followed by whitespace, so "6.52 percent" and "U.S." stay intact.
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?।])\s+/u)
    .filter(Boolean)
}

function tokens(s) {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 2 && !STOP.has(w))
}

/**
 * @returns {{ summary: string, keyPoints: string[] }}
 */
function extractiveSummary(text, { maxSentences = 3, maxKeyPoints = 4 } = {}) {
  const sentences = splitSentences(text).map(s => s.trim()).filter(s => s.length >= 30 && s.length <= 400)
  if (!sentences.length) {
    const t = String(text || '').replace(/\s+/g, ' ').trim()
    return { summary: t.slice(0, 280), keyPoints: [] }
  }

  const freq = new Map()
  for (const s of sentences) for (const w of tokens(s)) freq.set(w, (freq.get(w) || 0) + 1)
  const maxF = Math.max(...freq.values(), 1)

  const scored = sentences.map((s, i) => {
    const toks = tokens(s)
    if (!toks.length) return { s, i, score: 0 }
    let score = toks.reduce((a, w) => a + (freq.get(w) || 0) / maxF, 0) / Math.sqrt(toks.length)
    const entities = (s.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g) || []).length
    score += Math.min(entities, 4) * 0.15
    if (/\d/.test(s)) score += 0.25                       // figures, dates, amounts
    if (/\b(announced|said|according to|reported|confirmed|claimed|ordered|signed|raised|rose|fell|died|killed|arrested)\b/i.test(s)) score += 0.2
    score += Math.max(0, 0.4 - i * 0.05)                  // lead sentences matter most in news
    if (/^(so|and|but|well|okay|yeah)\b/i.test(s)) score -= 0.2
    return { s, i, score }
  })

  const byScore = [...scored].sort((a, b) => b.score - a.score)
  const chosen = byScore.slice(0, maxSentences).sort((a, b) => a.i - b.i)
  const summary = chosen.map(c => c.s).join(' ')

  const chosenSet = new Set(chosen.map(c => c.i))
  const keyPoints = byScore.filter(c => !chosenSet.has(c.i)).slice(0, maxKeyPoints).sort((a, b) => a.i - b.i).map(c => c.s)
  return { summary, keyPoints }
}

module.exports = { extractiveSummary, splitSentences }
