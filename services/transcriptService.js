const { getSubtitles } = require('youtube-captions-scraper')
const cache = require('./cacheService')

/**
 * PHASE 1 V2 REFINED: High-Reliability Transcript Engine
 */

// In-memory transcript cache keyed by video ID.
// Re-analyzing the same video skips caption scraping / audio download entirely,
// which avoids repeat YouTube requests (and their 403 rate-limit blocks).
const TRANSCRIPT_TTL_MS = 1000 * 60 * 60 * 6 // 6 hours

function getCachedTranscript(videoId) {
  return cache.get(cache.generateKey('transcript_v1', videoId))
}

function setCachedTranscript(videoId, value) {
  cache.set(cache.generateKey('transcript_v1', videoId), value, TRANSCRIPT_TTL_MS)
}

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

const axios = require('axios')

async function fetchYoutubeMetadataFallback(videoId, url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    const res = await axios.get(oembedUrl, { timeout: 8000 })
    if (res.data && res.data.title) {
      const title = res.data.title
      const author = res.data.author_name || 'YouTube Channel'
      const content = `Title: ${title}\nAuthor/Publisher: ${author}\nVideo URL: https://www.youtube.com/watch?v=${videoId}`
      return {
        transcript: content,
        transcriptSource: 'youtube-oembed-metadata',
        languageDetected: 'en',
        metadataOnly: true,
        transcriptConfidence: 30,
        fallbackUsed: true,
        audioQuality: 'low'
      }
    }
  } catch (err) {
    console.warn(`[transcript:${videoId}] oEmbed fetch failed: ${err.message}`)
  }

  try {
    const noembedUrl = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
    const res = await axios.get(noembedUrl, { timeout: 8000 })
    if (res.data && res.data.title) {
      const title = res.data.title
      const author = res.data.author_name || 'YouTube Channel'
      const content = `Title: ${title}\nAuthor/Publisher: ${author}\nVideo URL: https://www.youtube.com/watch?v=${videoId}`
      return {
        transcript: content,
        transcriptSource: 'noembed-metadata',
        languageDetected: 'en',
        metadataOnly: true,
        transcriptConfidence: 30,
        fallbackUsed: true,
        audioQuality: 'low'
      }
    }
  } catch (err) {
    console.warn(`[transcript:${videoId}] NoEmbed fetch failed: ${err.message}`)
  }

  return null
}

// ── yt-dlp subtitle fallback (works when the scraper library is blocked/broken) ─
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

function parseVtt(vtt) {
  const out = []
  let last = ''
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line === 'WEBVTT' || /^(Kind|Language|NOTE|STYLE)\b/.test(line) || /-->/.test(line) || /^\d+$/.test(line)) continue
    const text = line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
    if (text && text !== last) { out.push(text); last = text }
  }
  return out.join(' ')
}

async function tryYtDlpSubtitles(videoId) {
  const bin = process.env.YTDLP_PATH || 'yt-dlp'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl_subs_'))
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    '--skip-download', '--write-subs', '--write-auto-subs',
    '--sub-langs', 'en.*,en,hi.*,te.*,ta.*', '--sub-format', 'vtt',
    '--no-playlist', '--no-warnings', '--socket-timeout', '20',
    '-o', path.join(dir, '%(id)s.%(ext)s')
  ]
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES)
  if (process.env.YTDLP_JS_RUNTIME) args.push('--js-runtimes', process.env.YTDLP_JS_RUNTIME)
  try {
    await new Promise((resolve, reject) => {
      const p = spawn(bin, args)
      const timer = setTimeout(() => { p.kill(); reject(new Error('yt-dlp subtitle fetch timed out')) }, 60000)
      p.on('error', e => { clearTimeout(timer); reject(e) })
      p.on('close', () => { clearTimeout(timer); resolve() })
    })
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.vtt'))
    if (!files.length) throw new Error('No subtitles available via yt-dlp')
    // Prefer manual subtitles (no ".en-orig"/auto marker is not reliable) -> shortest name first, then English.
    files.sort((a, b) => (/\.en[.-]/.test(a) ? 0 : 1) - (/\.en[.-]/.test(b) ? 0 : 1))
    const text = parseVtt(fs.readFileSync(path.join(dir, files[0]), 'utf8'))
    if (text.length < 100) throw new Error('Subtitles too short')
    return { text, language: (files[0].match(/\.([a-zA-Z-]+)\.vtt$/) || [])[1] || 'en' }
  } finally {
    try { fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f))); fs.rmdirSync(dir) } catch (_) {}
  }
}

async function fetchTranscriptWithFallback(url) {
  const videoId = extractVideoId(url)
  if (!videoId) { const e = new Error('Invalid YouTube URL'); e.errorCode = 'INVALID_URL'; e.status = 400; throw e }

  // Cache hit — skip caption scraping and audio download entirely
  const cached = getCachedTranscript(videoId)
  if (cached) {
    console.info(`[transcript:${videoId}] Using cached transcript (${cached.transcriptSource}).`)
    return cached
  }

  // Step 1: Attempt Captions (Prefer Manual -> Auto)
  try {
    const result = await tryFetchCaptions(videoId)
    if (result.text && result.text.length > 50) {
      const value = {
        transcript: result.text,
        transcriptSource: result.isAuto ? 'youtube-auto-captions' : 'youtube-manual-captions',
        languageDetected: result.language,
        transcriptConfidence: result.isAuto ? 92 : 98,
        fallbackUsed: false,
        audioQuality: 'high' // Captions imply good digital source
      }
      setCachedTranscript(videoId, value)
      return value
    }
  } catch (e) {
    console.info(`[transcript:${videoId}] Caption scraper found nothing (${e && e.message}). Trying yt-dlp subtitles...`);
  }

  // Step 1b: yt-dlp subtitles
  try {
    const sub = await tryYtDlpSubtitles(videoId)
    const value = {
      transcript: sub.text,
      transcriptSource: 'youtube-ytdlp-subtitles',
      languageDetected: sub.language,
      transcriptConfidence: 90,
      fallbackUsed: false,
      audioQuality: 'high'
    }
    setCachedTranscript(videoId, value)
    return value
  } catch (e) {
    console.info(`[transcript:${videoId}] yt-dlp subtitles unavailable (${e.message}). Initiating Whisper AI fallback...`)
  }

  // Step 2: Whisper Fallback
  const { transcribeFromAudio } = require('./audioTranscriptionService')
  try {
    const audioResult = await transcribeFromAudio(url)
    setCachedTranscript(videoId, audioResult)
    return audioResult
  } catch (err) {
    // Standardize Errors
    if (err.message.includes('age-restricted') || err.errorCode === 'VIDEO_RESTRICTED') {
      const e = new Error('This video is age-restricted or requires sign-in.')
      e.errorCode = 'VIDEO_RESTRICTED'; e.status = 422; throw e
    }
    console.warn(`[transcript:${videoId}] Whisper/Audio fallback failed (${err.message}). Attempting metadata fallback...`);
  }

  // Step 3: Metadata Fallback (oEmbed / NoEmbed)
  try {
    const metaResult = await fetchYoutubeMetadataFallback(videoId, url)
    if (metaResult && metaResult.transcript && metaResult.transcript.length >= 20) {
      setCachedTranscript(videoId, metaResult)
      return metaResult
    }
  } catch (metaErr) {
    console.error(`[transcript:${videoId}] Metadata fallback failed: ${metaErr.message}`)
  }

  const e = new Error('Unable to extract a transcript from this video. It may be private, age-restricted, have no speech, or be blocked by YouTube. Try pasting the transcript as text.')
  e.errorCode = 'TRANSCRIPT_UNAVAILABLE'; e.status = 422
  throw e
}

module.exports = { fetchTranscriptWithFallback, extractVideoId }
