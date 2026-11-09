/**
 * Central LLM configuration. The model is env-configurable so a retired model
 * (Groq returns 404 for those) can be swapped without a code change.
 */
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b'
const GROQ_WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3'

module.exports = { GROQ_API_URL, GROQ_MODEL, GROQ_WHISPER_MODEL }

// ── Reasoning-model tuning ────────────────────────────────────────────────────
// gpt-oss models spend part of max_tokens on hidden reasoning. Without headroom
// the visible JSON gets truncated, so every Groq chat call made through axios is
// adjusted here (one place, no per-call edits).
const axios = require('axios')
let installed = false
function installGroqTuning() {
  if (installed) return
  installed = true
  axios.interceptors.request.use((config) => {
    try {
      const url = String(config.url || '')
      const d = config.data
      if (url.startsWith(GROQ_API_URL) && d && typeof d === 'object' && /gpt-oss/.test(d.model || '')) {
        if (!d.reasoning_effort) d.reasoning_effort = 'low'
        if (typeof d.max_tokens === 'number') d.max_tokens = d.max_tokens + 1200
      }
    } catch (_) { /* never block a request because of tuning */ }
    return config
  })
}
installGroqTuning()

module.exports.installGroqTuning = installGroqTuning
