// Local embedding — no external APIs required
// Produces a deterministic 256-dim float vector from any text.
// Strategy: term-frequency weighted character-code projection.
// The same word always maps to the same bucket, so similarity
// between texts sharing vocabulary is preserved.

const DIMS = 256

/**
 * Converts text into a normalised 256-dimensional float vector.
 *
 * Algorithm:
 *  1. Tokenise into lowercase words (4+ chars, no stopwords)
 *  2. Extract named entities (capitalized phrases) with higher weight
 *  3. For each word compute a bucket index: sum of (charCode * position) mod DIMS
 *  4. Accumulate term frequency into that bucket with entity boosting
 *  5. L2-normalise the resulting vector so cosine similarity works correctly
 */
const generateEmbedding = async function(text) {
  try {
    if (!text || typeof text !== 'string') {
      console.warn('[embedding] Invalid input, creating zero vector')
      return new Array(DIMS).fill(0)
    }

    var vector = new Array(DIMS).fill(0)

    var STOPWORDS = new Set([
      'the','and','for','that','this','with','from','have','been','will',
      'they','their','there','what','when','which','your','about','into',
      'more','also','just','some','than','then','were','would','could',
      'should','does','did','has','had','its','not','but','are','was',
      'very','really','quite','such','much','many','most','other','same',
      'only','even','still','already','always','never','often','usually'
    ])

    var entities = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b/g) || []
    var entitySet = new Set(entities.map(e => e.toLowerCase()))

    var words = (text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
      .filter(function(w) { return !STOPWORDS.has(w) })

    console.log(`[embedding] Generated embedding from ${words.length} tokens, ${entities.length} entities (${text.length} chars)`)

    if (words.length === 0) {
      var sample = text.slice(0, DIMS)
      for (var ci = 0; ci < sample.length; ci++) {
        vector[ci % DIMS] += sample.charCodeAt(ci) / 128
      }
      console.log('[embedding] Using character-code fallback')
    } else {
      var tf = {}
      words.forEach(function(w) { 
        var weight = entitySet.has(w) ? 2.5 : 1.0
        tf[w] = (tf[w] || 0) + weight
      })

      Object.keys(tf).forEach(function(word) {
        var bucket = 0
        for (var i = 0; i < word.length; i++) {
          bucket = (bucket + word.charCodeAt(i) * (i + 1)) % DIMS
        }
        vector[bucket] += tf[word]
      })
    }

    var norm = Math.sqrt(vector.reduce(function(sum, v) { return sum + v * v }, 0))
    if (norm > 0) {
      vector = vector.map(function(v) { return v / norm })
    }

    return vector

  } catch (err) {
    console.error('[embedding] Error generating embedding:', err.message)
    return new Array(DIMS).fill(0)
  }
}

module.exports = { generateEmbedding }
