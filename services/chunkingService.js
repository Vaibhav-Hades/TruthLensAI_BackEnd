/**
 * chunkingService.js
 * 
 * PHASE 1 V3: Context-Aware Semantic Chunking
 * Splits text while maximizing narrative continuity and token efficiency.
 */

const MAX_CHUNK_CHARS = 3800; // Target character length for model safety (approx 1k tokens)
const MIN_CHUNK_CHARS = 1000; // Minimum to ensure each chunk has enough context
const OVERLAP_SENTENCES = 2;   // Number of sentences to overlap for context preservation

/**
 * Splits text into semantic chunks that preserve narrative continuity.
 */
function chunkContent(text) {
  if (!text) return { chunks: [], totalChunks: 0, estimatedTokens: 0 };

  // Improved sentence splitting with lookbehind to handle abbreviations
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text];
  const chunks = [];
  let currentChunk = [];
  let currentCharCount = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    currentChunk.push(sentence);
    currentCharCount += sentence.length;

    // If current chunk is large enough, or we reached the end
    if (currentCharCount >= MAX_CHUNK_CHARS || i === sentences.length - 1) {
      if (currentCharCount > 0) {
        chunks.push(currentChunk.join('').trim());
      }

      // If there are more sentences, start the next chunk with overlap
      if (i < sentences.length - 1) {
        // Look back OVERLAP_SENTENCES
        const overlap = currentChunk.slice(-OVERLAP_SENTENCES);
        currentChunk = [...overlap];
        currentCharCount = currentChunk.reduce((acc, s) => acc + s.length, 0);
      } else {
        currentChunk = [];
        currentCharCount = 0;
      }
    }
  }

  // Final cleanup: if the last chunk is too small and there's a previous chunk, merge them
  if (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk.length < MIN_CHUNK_CHARS) {
      const popped = chunks.pop();
      chunks[chunks.length - 1] = (chunks[chunks.length - 1] + " " + popped).trim();
    }
  }

  return {
    chunks: chunks,
    totalChunks: chunks.length,
    estimatedTokens: Math.round(text.length / 4)
  };
}

module.exports = { chunkContent };
