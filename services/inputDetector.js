/**
 * inputDetector.js
 * 
 * PHASE 1 V2: Intelligent Input Detection
 */

const { extractVideoId } = require('./transcriptService');

/**
 * Detects whether the input is a YouTube URL, an article URL, or raw text.
 * Returns structured metadata.
 */
function detectInputType(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new Error('Input is empty');
  }

  // 1. Check for YouTube
  const videoId = extractVideoId(trimmed);
  if (videoId) {
    return {
      type: 'video',
      source: 'youtube',
      platform: 'youtube',
      normalizedInput: trimmed,
      videoId: videoId
    };
  }

  // 2. Check for other social video platforms (Instagram Reels)
  const isInstagram = /instagram\.com\/(reels?|p|tv)\//i.test(trimmed) || /instagr\.am\/p\//i.test(trimmed);
  if (isInstagram) {
    return {
      type: 'video',
      source: 'social_media',
      platform: 'instagram',
      normalizedInput: trimmed
    };
  }

  // 3. Check if it's a URL (likely an article/news)
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      // Basic domain extraction for source naming
      const source = url.hostname.replace('www.', '');
      return {
        type: 'article',
        source: source,
        platform: 'web_article',
        normalizedInput: trimmed
      };
    }
  } catch (e) {
    // Not a valid URL
  }

  // 4. Fallback to raw text (Manual Claim)
  return {
    type: 'text',
    source: 'manual_input',
    platform: 'raw_text',
    normalizedInput: trimmed
  };
}

module.exports = { detectInputType };
