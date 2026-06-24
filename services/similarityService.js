const supabase = require('../config/supabase')
const { generateEmbedding } = require('./embeddingService')

// Cosine similarity between two equal-length float vectors
const cosineSimilarity = function(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0
  var dot = 0, normA = 0, normB = 0
  for (var i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  var denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Compares transcript embedding against all DB sources.
 *
 * Threshold is lower (0.1) than the OpenAI version because local
 * sparse vectors naturally produce lower cosine scores than dense
 * neural embeddings — but relative ranking is still meaningful.
 *
 * truthScore derivation:
 *   - Best single similarity score scaled to 0–100
 *   - Blended with average of top matches for stability
 *   - Weighted by number of quality matches (more matches = higher confidence)
 *   - Conservative scoring to avoid false high scores
 *   - Always returns a number (minimum 0)
 *
 * If a stored source has an embedding from the old OpenAI seed run
 * (wrong dimensions), it is re-embedded on the fly using local logic.
 */
const findMatchingSources = async function(transcriptEmbedding) {
  const SIMILARITY_THRESHOLD = 0.10
  const TOP_N = 5
  const EXPECTED_DIMS = transcriptEmbedding ? transcriptEmbedding.length : 0

  console.log(`[similarity] Starting source matching with embedding dims: ${EXPECTED_DIMS}`)

  if (!transcriptEmbedding || transcriptEmbedding.length === 0) {
    console.warn('[similarity] Invalid embedding, returning zero score')
    return { truthScore: 0, matchedSources: [] }
  }

  try {
    const { data: sources, error } = await supabase
      .from('sources')
      .select('label, url, embedding')

    if (error) {
      console.error('[similarity] Supabase error:', error.message)
      return { truthScore: 0, matchedSources: [] }
    }

    if (!sources || sources.length === 0) {
      console.warn('[similarity] No sources in database')
      return { truthScore: 50, matchedSources: [] }
    }

    console.log(`[similarity] Comparing against ${sources.length} sources`)

    var scoredPromises = sources.map(async function(source) {
      try {
        var embedding = source.embedding

        if (!embedding || embedding.length !== EXPECTED_DIMS) {
          embedding = await generateEmbedding(source.label + ' ' + source.url)
        }

        return {
          label:      source.label,
          url:        source.url,
          similarity: cosineSimilarity(transcriptEmbedding, embedding)
        }
      } catch (err) {
        console.warn(`[similarity] Error scoring source "${source.label}":`, err.message)
        return {
          label:      source.label,
          url:        source.url,
          similarity: 0
        }
      }
    })

    var scored = await Promise.all(scoredPromises)

    scored.sort(function(a, b) { return b.similarity - a.similarity })

    var matched = scored
      .filter(function(s) { return s.similarity >= SIMILARITY_THRESHOLD })
      .slice(0, TOP_N)

    console.log(`[similarity] Matched ${matched.length} sources above threshold ${SIMILARITY_THRESHOLD}`)

    var truthScore = 0
    if (matched.length > 0) {
      var best = matched[0].similarity
      var avg  = matched.reduce(function(sum, s) { return sum + s.similarity }, 0) / matched.length
      var matchWeight = Math.min(1.0, matched.length / TOP_N)
      
      // Conservative blending: 50% best + 35% avg + 15% match weight
      // Reduces over-reliance on single high match
      truthScore = Math.round(((best * 0.50) + (avg * 0.35) + (matchWeight * 0.15)) * 100)
      truthScore = Math.min(100, Math.max(0, truthScore))
      console.log(`[similarity] Truth score: ${truthScore} (best=${Math.round(best*100)}%, avg=${Math.round(avg*100)}%, matches=${matched.length})`)
    } else if (scored.length > 0) {
      // No match above threshold - use conservative score
      truthScore = Math.min(45, Math.round(scored[0].similarity * 100))
      console.warn(`[similarity] No matches above threshold, using conservative score: ${truthScore}`)
    } else {
      console.warn('[similarity] No sources scored, returning default')
      truthScore = 50
    }

    var matchedSources = matched.map(function(s) {
      return {
        label:      s.label,
        url:        s.url,
        similarity: parseFloat(s.similarity.toFixed(4))
      }
    })

    return { truthScore: truthScore, matchedSources: matchedSources }

  } catch (err) {
    console.error('[similarity] Unhandled error:', err.message)
    return { truthScore: 50, matchedSources: [] }
  }
}

module.exports = { findMatchingSources }
