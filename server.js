require('dotenv').config()
require('./config/llm') // installs Groq request tuning (reasoning-model token headroom)

const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')

const analyzeRoutes = require('./routes/analyze')
const chatRoutes = require('./routes/chat')
const adminRoutes = require('./routes/admin')
const authRoutes = require('./routes/auth')
const reportsRoutes = require('./routes/reports')
const flagsRoutes = require('./routes/flags')
const translateRoutes = require('./routes/translate')
const sarvamRoutes = require('./routes/sarvam')
const newsRoutes = require('./routes/news')

const IS_PROD = process.env.NODE_ENV === 'production'

// ── Fail fast on unsafe production configuration ──────────────────────────────
if (IS_PROD && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set when NODE_ENV=production (tokens would be forgeable with the default secret).')
  process.exit(1)
}

const app = express()
const PORT = parseInt(process.env.PORT, 10) || 10000

// Render / Vercel / any reverse proxy: needed for correct client IPs (rate limiting).
app.set('trust proxy', 1)

// ── CORS ──────────────────────────────────────────────────────────────────────
const normalizeOrigin = (str) => {
  if (!str || typeof str !== 'string') return ''
  return str.trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '')
}

const splitList = (v) => (v ? String(v).split(',').map(normalizeOrigin).filter(Boolean) : [])

const LOCAL_ORIGINS = [
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:4173',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173',
]

// Local dev origins + FRONTEND_URL + comma-separated CORS_ORIGINS (all merged, de-duplicated).
const getAllowedOrigins = () => [...new Set([
  ...LOCAL_ORIGINS,
  ...splitList(process.env.FRONTEND_URL),
  ...splitList(process.env.CORS_ORIGINS),
])]

// Vercel preview deployments (<project>-<hash>-<team>.vercel.app). Restricted to this project's
// name by default; set CORS_VERCEL_PATTERN to a RegExp source to change it, or CORS_ALLOW_VERCEL_PREVIEWS=false to disable.
const vercelPattern = () => {
  if (String(process.env.CORS_ALLOW_VERCEL_PREVIEWS).toLowerCase() === 'false') return null
  try { return new RegExp(process.env.CORS_VERCEL_PATTERN || '^https://truth-?lens[a-z0-9-]*\\.vercel\\.app$', 'i') }
  catch (_) { return null }
}

const isOriginAllowed = (origin) => {
  if (!origin) return true // curl, server-to-server, same-origin
  const clean = normalizeOrigin(origin)
  if (getAllowedOrigins().includes(clean)) return true
  if (clean.startsWith('chrome-extension://')) return true
  const re = vercelPattern()
  return Boolean(re && re.test(clean))
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true)
    if (!IS_PROD) console.warn(`[cors] blocked origin: ${origin}`)
    return callback(null, false) // no CORS headers => browser blocks; server logic is not affected
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
  maxAge: 86400,
  optionsSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }))

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Only /api/analyze is expensive (LLM + Event Registry + Whisper); the previous setup applied the
// 10/min limit to EVERY /api route, which throttled chat, login and dashboards too.
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.ANALYZE_RATE_LIMIT || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please wait a moment and try again.', errorCode: 'RATE_LIMITED' },
})
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.', errorCode: 'RATE_LIMITED' },
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'TruthLens AI API running' }))
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.use('/api', generalLimiter)
app.use('/api/analyze', analyzeLimiter)
app.use('/api', analyzeRoutes)
app.use('/api', chatRoutes)
app.use('/api', adminRoutes)
app.use('/api', authRoutes)
app.use('/api', reportsRoutes)
app.use('/api', flagsRoutes)
app.use('/api', translateRoutes)
app.use('/api', newsRoutes)
app.use('/api/sarvam', sarvamRoutes)

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}`, errorCode: 'NOT_FOUND' })
})

// ── Global error handler ──────────────────────────────────────────────────────
// Registered after CORS, so error responses still carry CORS headers and the browser shows the
// real JSON error instead of a misleading "CORS error".
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const errorId = Date.now().toString(36).toUpperCase()
  let status = err.status || err.statusCode || 500
  let message = err.message || 'Internal server error'
  let errorCode = err.errorCode || 'INTERNAL_ERROR'

  if (err.type === 'entity.too.large') { status = 413; errorCode = 'PAYLOAD_TOO_LARGE'; message = 'The request is too large.' }
  else if (err.type === 'entity.parse.failed') { status = 400; errorCode = 'INVALID_JSON'; message = 'Request body is not valid JSON.' }

  console.error(`[ERROR ${errorId}] ${req.method} ${req.path} -> ${status} ${errorCode}: ${message}`)
  if (status >= 500 && !IS_PROD && err.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'))

  const body = { error: status >= 500 && IS_PROD ? 'Internal server error' : message, errorCode, errorId }
  if (!IS_PROD && err.stack && status >= 500) body.stack = err.stack.split('\n').slice(0, 5)
  if (err.details && !IS_PROD) body.details = err.details
  res.status(status).json(body)
})

// ── Start (exactly one listen call) ───────────────────────────────────────────
function start(port = PORT) {
  const server = app.listen(port, () => {
    const addr = server.address()
    console.log(`TruthLens API listening on port ${addr && addr.port ? addr.port : port}`)
    console.log('Allowed origins:', getAllowedOrigins().join(', '))
    const missing = ['GROQ_API_KEY', 'ER_API_KEY', 'SUPABASE_URL'].filter(k => !process.env[k])
    if (missing.length) console.warn('Missing optional/required env (features degrade gracefully):', missing.join(', '))
  })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or set a different PORT in .env (e.g. PORT=${port + 1}).`)
    } else if (err.code === 'EACCES') {
      console.error(`Port ${port} requires elevated permission. Choose a port above 1024.`)
    } else {
      console.error('Server failed to start:', err.message)
    }
    process.exit(1)
  })
  // Long analyses (Whisper fallback) can take minutes; keep sockets alive past typical proxy idle times.
  server.keepAliveTimeout = 65000
  server.headersTimeout = 70000
  return server
}

if (require.main === module) start()

module.exports = { app, start, isOriginAllowed, getAllowedOrigins }
