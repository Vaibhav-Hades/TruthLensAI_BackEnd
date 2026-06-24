const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const supabase = require('../config/supabase')

const JWT_SECRET  = process.env.JWT_SECRET  || 'tl_dev_secret_change_in_prod'
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d'

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
const signup = async function(req, res, next) {
  try {
    const { name, email, password, role, phone, location } = req.body

    // ── Validation ────────────────────────────────────────────────────────────
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.', errorCode: 'MISSING_FIELDS' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.', errorCode: 'WEAK_PASSWORD' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', errorCode: 'INVALID_EMAIL' })
    }

    const cleanEmail = email.toLowerCase().trim()
    const cleanName  = name.trim().slice(0, 80)

    // ── Check for existing account ────────────────────────────────────────────
    const { data: existing, error: lookupErr } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle()

    if (lookupErr) {
      console.error('Supabase lookup error:', lookupErr.message)
      return next(new Error('Database error during signup.'))
    }
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.', errorCode: 'EMAIL_EXISTS' })
    }

    // ── Hash password ─────────────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(password, 12)

    // ── Insert user ───────────────────────────────────────────────────────────
    const { data: newUser, error: insertErr } = await supabase
      .from('users')
      .insert({
        name:       cleanName,
        email:      cleanEmail,
        password:   hashedPassword,
        role:       role || null,
        phone:      phone || null,
        location:   location || null,
        created_at: new Date().toISOString(),
      })
      .select('id, name, email, role, phone, location, created_at')
      .single()

    if (insertErr) {
      console.error('Supabase insert error:', insertErr.message)
      return next(new Error('Failed to create account. Please try again.'))
    }

    const token = signToken(newUser.id)

    return res.status(201).json({
      token,
      user: {
        id:          newUser.id,
        name:        newUser.name,
        email:       newUser.email,
        role:        newUser.role,
        phone:       newUser.phone,
        location:    newUser.location,
        createdAt:   newUser.created_at,
        reportCount: 0,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
const login = async function(req, res, next) {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.', errorCode: 'MISSING_FIELDS' })
    }

    const cleanEmail = email.toLowerCase().trim()

    // ── Fetch user (include password for comparison) ──────────────────────────
    const { data: user, error: lookupErr } = await supabase
      .from('users')
      .select('id, name, email, password, created_at')
      .eq('email', cleanEmail)
      .maybeSingle()

    if (lookupErr) {
      console.error('Supabase lookup error:', lookupErr.message)
      return next(new Error('Database error during login.'))
    }

    // Use the same generic message for both "not found" and "wrong password"
    // to prevent user enumeration
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.', errorCode: 'INVALID_CREDENTIALS' })
    }

    // ── Verify password ───────────────────────────────────────────────────────
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.', errorCode: 'INVALID_CREDENTIALS' })
    }

    const token = signToken(user.id)

    return res.status(200).json({
      token,
      user: {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        createdAt:   user.created_at,
        reportCount: 0,   // reports are stored separately; fetch from reports table if needed
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── GET /api/auth/profile + GET /api/user/profile (protected) ────────────────
const getProfile = async function(req, res, next) {
  try {
    // req.user is set by authMiddleware (Supabase row, no password)
    const user = req.user

    return res.status(200).json({
      id:        user.id,
      name:      user.name,
      email:     user.email,
      createdAt: user.created_at,
      stats: {
        reportCount: 0,
        avgScore:    0,
        highRisk:    0,
        trusted:     0,
      },
      recentReports: [],
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { signup, login, getProfile }
