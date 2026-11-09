const supabase = require('../config/supabase')

/** Answers 503 with a clear message when Supabase is not configured, instead of a vague 500. */
module.exports = function requireDb(req, res, next) {
  if (!supabase.isConfigured) {
    return res.status(503).json({
      error: 'The database is not configured on the server.',
      errorCode: 'DB_NOT_CONFIGURED',
      suggestion: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) on the backend.'
    })
  }
  next()
}
