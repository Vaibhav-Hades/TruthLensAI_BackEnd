/**
 * contentExtractor.js
 * 
 * Legacy wrapper for the stabilized Phase 1 Pipeline.
 * Maintained for backward compatibility.
 */

const { runPhase1Pipeline } = require('./pipelineService');

/**
 * Extracts analyzable text from any supported content type.
 * Now powered by the stabilized Phase 1 Pipeline.
 *
 * @param {string} input       — URL or raw text
 * @param {string} contentType — 'video' | 'article' | 'text' (deprecated, now auto-detected)
 * @returns {Promise<string>}  — extracted text ready for LLM + embedding
 */
const extractContent = async function(input, contentType) {
  // We use the new pipeline but return only the cleanedTranscript to maintain backward compatibility
  const result = await runPhase1Pipeline(input);
  return result.cleanedTranscript;
}

module.exports = { extractContent };
