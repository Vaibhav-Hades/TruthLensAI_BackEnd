// audioTranscriptionService.js
// Full pipeline: yt-dlp download → ffmpeg processing → Groq Whisper transcription
//
// PHASE 1 V2: Production-Grade Transcript Intelligence

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const axios = require('axios')
const FormData = require('form-data')

// ── Constants ─────────────────────────────────────────────────────────────────
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const WHISPER_MODEL    = 'whisper-large-v3'
const MAX_DURATION_SEC = 1800                  // Increased to 30 minutes
const MAX_FILE_BYTES   = 24 * 1024 * 1024      // 24MB (safe margin for Groq 25MB)
const FFMPEG_BITRATE   = '32k'                 // Slightly higher for better fidelity
const FFMPEG_SAMPLE    = '16000'               // Whisper native

const IS_WINDOWS = process.platform === 'win32'
const YTDLP_BIN  = process.env.YTDLP_PATH  || 'yt-dlp'
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg'

// ── Tool checks ────────────────────────────────────────────────────────────────
async function checkTool(name) {
  return new Promise((resolve) => {
    const cmd = IS_WINDOWS ? 'where' : 'which'
    const proc = spawn(cmd, [name])
    proc.on('close', code => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

// ── Step 1: Download Audio ────────────────────────────────────────────────────
async function downloadRawAudio(videoUrl) {
  const tmpDir = os.tmpdir()
  const dlDir  = path.join(tmpDir, `tl_forensic_${Date.now()}_${Math.floor(Math.random()*1000)}`)
  if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true })

  const outTpl = path.join(dlDir, '%(id)s.%(ext)s')

  const args = [
    videoUrl,
    '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
    '--output', outTpl,
    '--no-playlist',
    '--max-downloads', '1',
    '--match-filter', `duration <= ${MAX_DURATION_SEC}`,
    '--no-warnings',
    '--no-part',
    '--retries', '3',
    '--fragment-retries', '5'
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args)
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => {
      const full = stderr.toLowerCase()
      if (full.includes('duration')) {
        return reject(Object.assign(new Error(`Video exceeds ${MAX_DURATION_SEC/60}m limit.`), { errorCode: 'VIDEO_TOO_LONG', status: 422 }))
      }
      if (full.includes('age-restricted') || full.includes('sign in')) {
        return reject(Object.assign(new Error('Video is age-restricted or requires sign-in.'), { errorCode: 'VIDEO_RESTRICTED', status: 422 }))
      }

      // Dynamic detection of downloaded file
      try {
        const files = fs.readdirSync(dlDir).filter(f => fs.statSync(path.join(dlDir, f)).size > 1024)
        if (files.length > 0) resolve(path.join(dlDir, files[0]))
        else reject(new Error('No audio file found after download.'))
      } catch (e) { reject(e) }
    })
  })
}

// ── Step 2: Advanced FFmpeg Preprocessing ─────────────────────────────────────
async function processAudioWithFfmpeg(rawPath) {
  const outPath = path.join(path.dirname(rawPath), `forensic_processed_${Date.now()}.mp3`)

  return new Promise((resolve, reject) => {
    // Production-grade filters for speech intelligence:
    // 1. afftdn: Spectral noise reduction
    // 2. highpass/lowpass: Filter out non-speech frequencies (150Hz - 8kHz)
    // 3. speechnorm: Intelligent dynamic range compression for clear speech
    // 4. volume: Peak normalization
    const filters = [
      'afftdn=nf=-25:tn=1', 
      'highpass=f=150', 
      'lowpass=f=8000', 
      'speechnorm=e=4:r=0.0001:p=0.9',
      'volume=1.5'
    ].join(',')

    const args = [
      '-i', rawPath,
      '-vn',
      '-ac', '1',
      '-ar', FFMPEG_SAMPLE,
      '-ab', FFMPEG_BITRATE,
      '-af', filters,
      '-f', 'mp3',
      '-y',
      outPath
    ]

    const proc = spawn(FFMPEG_BIN, args)
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => {
      if (code !== 0) reject(new Error('FFmpeg failed: ' + stderr.slice(-200)))
      else resolve(outPath)
    })
  })
}

/**
 * STEP 6: AUDIO QUALITY ESTIMATION
 * Heuristic based on file size and processing metadata
 */
function estimateAudioQuality(confidence) {
  if (confidence > 85) return 'high';
  if (confidence > 60) return 'medium';
  return 'low';
}

// ── Step 3: Multilingual Whisper ──────────────────────────────────────────────
async function transcribeWithWhisper(audioPath) {
  const key = process.env.GROQ_API_KEY
  const form = new FormData()
  form.append('file', fs.createReadStream(audioPath))
  form.append('model', WHISPER_MODEL)
  form.append('response_format', 'verbose_json')
  
  // Advanced forensic prompt for multilingual Indian context
  form.append('prompt', [
    'Transcribe this Indian news discussion accurately.',
    'It contains English, Hindi, Telugu, Tamil, and Hinglish.',
    'Preserve regional entities: BJP, DMK, TDP, Congress, YSRCP, AAP, etc.',
    'Maintain natural flow and punctuation even for mixed-language speech.',
    'Filter out technical background noise artifacts from the final text.'
  ].join(' '))

  const response = await axios.post(GROQ_WHISPER_URL, form, {
    headers: { 'Authorization': `Bearer ${key}`, ...form.getHeaders() },
    timeout: 300000
  })

  return {
    text: response.data.text.trim(),
    language: response.data.language || 'detected',
    confidence: response.data.avg_logprob ? Math.min(100, Math.round((Math.exp(response.data.avg_logprob)) * 100)) : 85
  }
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────
async function transcribeFromAudio(videoUrl) {
  let rawPath = null, processedPath = null, dlDir = null;

  try {
    rawPath = await downloadRawAudio(videoUrl)
    dlDir = path.dirname(rawPath)
    
    processedPath = await processAudioWithFfmpeg(rawPath)
    const result = await transcribeWithWhisper(processedPath)

    return {
      transcript: result.text,
      transcriptSource: 'whisper-ai-fallback',
      languageDetected: result.language,
      transcriptConfidence: result.confidence,
      fallbackUsed: true,
      audioQuality: estimateAudioQuality(result.confidence)
    }
  } catch (err) {
    if (err.errorCode) throw err
    throw new Error('Audio transcription pipeline failed: ' + err.message)
  } finally {
    if (processedPath) try { fs.unlinkSync(processedPath) } catch(e){}
    if (dlDir) {
      try {
        fs.readdirSync(dlDir).forEach(f => fs.unlinkSync(path.join(dlDir, f)))
        fs.rmdirSync(dlDir)
      } catch(e){}
    }
  }
}

module.exports = { transcribeFromAudio }
