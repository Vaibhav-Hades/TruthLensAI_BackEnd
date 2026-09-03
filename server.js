require('dotenv').config()

const express = require('express')
const cors    = require('cors')

// express-rate-limit is optional — server starts without it
let rateLimit
try { rateLimit = require('express-rate-limit') } catch (_) { rateLimit = null }

const analyzeRoutes   = require('./routes/analyze')
const chatRoutes      = require('./routes/chat')
const adminRoutes     = require('./routes/admin')
const authRoutes      = require('./routes/auth')
const reportsRoutes   = require('./routes/reports')
const flagsRoutes     = require('./routes/flags')
const translateRoutes = require('./routes/translate')
const sarvamRoutes    = require('./routes/sarvam')

const app  = express()
const PORT = process.env.PORT || 10000

// ── Helper to normalize origin strings ───────────────────────────────────────
const normalizeOrigin = (str) => {
  if (!str || typeof str !== 'string') return ''
  return str
    .trim()
    .replace(/^["']|["']$/g, '') // strip surrounding quotes if any
    .replace(/\/+$/, '')         // strip trailing slash
}

// ── Parse allowed origins from environment ────────────────────────────────────
const getAllowedOrigins = () => {
  const defaultOrigins = [
    process.env.FRONTEND_URL,
    'https://truth-lens-ai-front-qj0wrw3x-vaibhav-hades-projects-030062f0.vercel.app',
    'https://truth-lens-ai-front-end.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ]

  let origins = defaultOrigins.map(normalizeOrigin).filter(Boolean)

  // If CORS_ORIGINS is set in .env, add those (comma-separated)
  if (process.env.CORS_ORIGINS) {
    const customOrigins = process.env.CORS_ORIGINS.split(',').map(normalizeOrigin).filter(Boolean)
    origins = [...origins, ...customOrigins]
  }

  return [...new Set(origins)]
}

// ── CORS Configuration ────────────────────────────────────────────────────────
const allowedOrigins = getAllowedOrigins()
console.log("Allowed Origins:", allowedOrigins)
console.log("Allowed Origins JSON:", JSON.stringify(allowedOrigins))
console.log("FRONTEND_URL:", JSON.stringify(process.env.FRONTEND_URL))
console.log("CORS_ORIGINS:", JSON.stringify(process.env.CORS_ORIGINS))

const corsOptions = {
  origin: (origin, callback) => {
    console.log("Incoming Origin:", JSON.stringify(origin))
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true)

    const cleanOrigin = normalizeOrigin(origin)

    // Allow all Chrome extension origins (popup, content scripts, background)
    if (cleanOrigin.startsWith('chrome-extension://')) return callback(null, true)

    // Allow explicitly listed origins (normalized)
    if (allowedOrigins.includes(cleanOrigin)) return callback(null, true)

    // Allow Vercel preview & production deployment URLs (*.vercel.app)
    if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/i.test(cleanOrigin) || cleanOrigin.endsWith('.vercel.app')) {
      return callback(null, true)
    }

    console.warn(`CORS request from unauthorized origin: ${origin}`)
    return callback(null, false)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 200,
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors(corsOptions))
app.use(express.json())

// ── Rate limiter — /api/analyze only (prevents LLM API cost abuse) ────────────
const analyzeLimiter = rateLimit
  ? rateLimit({
      windowMs:        60 * 1000,
      max:             10,
      standardHeaders: true,
      legacyHeaders:   false,
      message: { error: 'Too many analysis requests. Please wait a moment and try again.', errorCode: 'RATE_LIMITED' },
    })
  : function(req, res, next) { next() }  // no-op if package not installed

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', analyzeLimiter, analyzeRoutes)
app.use('/api', chatRoutes)
app.use('/api', adminRoutes)
app.use('/api', authRoutes)
app.use('/api', reportsRoutes)
app.use('/api', flagsRoutes)
app.use('/api', translateRoutes)
app.use('/api/sarvam', sarvamRoutes)

app.get('/', function(req, res) {
  res.json({ status: 'TruthLens AI API running' })
})

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Global error handler ──────────────────────────────────────────────────────
app.use(function(err, req, res, next) {
  const errorId = Date.now().toString(36).toUpperCase()
  const isDev = process.env.NODE_ENV === 'development'

  // Log with structured format
  console.error(`\n[ERROR ${errorId}] ${new Date().toISOString()}`)
  console.error(`Path: ${req.method} ${req.path}`)
  console.error(`Message: ${err.message || 'Unknown error'}`)
  if (err.code) console.error(`Code: ${err.code}`)
  if (err.status) console.error(`Status: ${err.status}`)
  if (isDev && err.stack) {
    console.error('Stack:')
    console.error(err.stack.split('\n').slice(0, 10).join('\n'))
  }
  console.error(`\n`)

  const status = err.status || 500
  const response = {
    error: err.message || 'Internal server error',
    errorCode: err.errorCode || 'INTERNAL_ERROR',
    errorId: errorId,
  }

  // Include stack trace in development
  if (isDev && err.stack) {
    response.stack = err.stack.split('\n').slice(0, 5)
  }

  // Include debugging details if available
  if (err.details) {
    response.details = err.details
  }

  res.status(status).json(response)
})

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT)
})
