const { getSubtitles } = require('youtube-captions-scraper')

/**
 * PHASE 1 V2 REFINED: High-Reliability Transcript Engine
 */

const LANG_FALLBACKS = [
  { code: 'en', label: 'English (Manual)', priority: 1 },
  { code: 'hi', label: 'Hindi (Manual)',   priority: 1 },
  { code: 'te', label: 'Telugu (Manual)',  priority: 1 },
  { code: 'ta', label: 'Tamil (Manual)',   priority: 1 },
  { code: 'en-US', label: 'English (US)',  priority: 2 },
  { code: 'en-IN', label: 'English (India)', priority: 2 },
  { code: 'a.en', label: 'English (Auto)', priority: 3 },
  { code: 'a.hi', label: 'Hindi (Auto)',   priority: 3 }
]

const extractVideoId = (url) => {
  if (!url) return null
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*\/v\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

async function tryFetchCaptions(videoId) {
  let lastErr = null
  // Sort by priority just in case
  const sorted = [...LANG_FALLBACKS].sort((a,b) => a.priority - b.priority)

  for (const lang of sorted) {
    try {
      const captions = await getSubtitles({ videoID: videoId, lang: lang.code })
      if (captions && captions.length > 5) { // Basic density check
        const text = captions.map(c => (c.text || '').trim()).filter(t => t.length > 0).join(' ')
        if (text.length > 100) {
          return { 
            text,
            language: lang.code,
            isAuto: lang.code.startsWith('a.'),
            label: lang.label
          }
        }
      }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('No accessible captions found')
}

async function fetchTranscriptWithFallback(url) {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('Invalid YouTube URL')

  // Step 1: Attempt Captions (Prefer Manual -> Auto)
  try {
    const result = await tryFetchCaptions(videoId)
    if (result.text && result.text.length > 50) {
      return {
        transcript: result.text,
        transcriptSource: result.isAuto ? 'youtube-auto-captions' : 'youtube-manual-captions',
        languageDetected: result.language,
        transcriptConfidence: result.isAuto ? 92 : 98,
        fallbackUsed: false,
        audioQuality: 'high' // Captions imply good digital source
      }
    }
  } catch (e) {
    console.info(`[transcript:${videoId}] Captions unavailable or restricted. Initiating Whisper AI fallback...`);
  }

  // Step 2: Whisper Fallback
  const { transcribeFromAudio } = require('./audioTranscriptionService')
  try {
    const audioResult = await transcribeFromAudio(url)
    return audioResult
  } catch (err) {
    // Standardize Errors
    if (err.message.includes('age-restricted')) {
      const e = new Error('This video is age-restricted or requires sign-in.')
      e.errorCode = 'VIDEO_RESTRICTED'; e.status = 422; throw e
    }
    throw err
  }
}

module.exports = { fetchTranscriptWithFallback, extractVideoId }
