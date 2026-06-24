const jwt      = require('jsonwebtoken')
const supabase = require('../config/supabase')

const JWT_SECRET = process.env.JWT_SECRET || 'tl_dev_secret_change_in_prod'

const auth = async function(req, res, next) {
  try {
    // ── Extract Bearer token ──────────────────────────────────────────────────
    const header = req.headers.authorization || ''
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided.', errorCode: 'NO_TOKEN' })
    }

    const token = header.slice(7)

    // ── Verify JWT ────────────────────────────────────────────────────────────
    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token.', errorCode: 'INVALID_TOKEN' })
    }

    // ── Look up user in Supabase (never return password) ──────────────────────
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, created_at')
      .eq('id', decoded.userId)
      .maybeSingle()

    if (error) {
      console.error('Supabase auth middleware error:', error.message)
      return res.status(500).json({ error: 'Authentication check failed.', errorCode: 'AUTH_ERROR' })
    }

    if (!user) {
      return res.status(401).json({ error: 'User not found.', errorCode: 'USER_NOT_FOUND' })
    }

    // Attach user to request for downstream handlers
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = auth
