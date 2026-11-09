/**
 * analysisLogService.js — best-effort log of every completed analysis (anonymous, no content stored).
 * Powers the admin dashboard with real numbers. Failures never affect the analyze response.
 * Requires the `analyses` table from setup-supabase.sql.
 */
const supabase = require('../config/supabase')

async function logAnalysis({ url, contentType, prediction, truthScore, confidence }) {
  if (!supabase.isConfigured) return
  try {
    const { error } = await supabase.from('analyses').insert({
      input_ref: String(url || '').slice(0, 300),
      content_type: contentType || 'text',
      prediction,
      truth_score: truthScore,
      confidence,
      created_at: new Date().toISOString()
    })
    if (error) console.warn('[analysis-log] insert skipped:', error.message)
  } catch (err) {
    console.warn('[analysis-log] failed:', err.message)
  }
}

module.exports = { logAnalysis }
