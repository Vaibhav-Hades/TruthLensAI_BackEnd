/**
 * End-to-end API tests against the real Express app on an ephemeral port.
 * External HTTP (Groq, Event Registry, websites) is scripted via tests/helpers/mockHttp.js;
 * Supabase is an in-memory fake. These prove the application logic, not the third-party services.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const dns = require('dns')
const path = require('path')

// ---- environment BEFORE requiring the app ----
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret'
process.env.GROQ_API_KEY = 'test-groq'
process.env.ER_API_KEY = 'test-er'
process.env.FRONTEND_URL = 'https://app.example.vercel.app/'
process.env.CORS_ORIGINS = 'https://extra.example.com'
process.env.ANALYZE_RATE_LIMIT = '1000'
process.env.REFERENCE_DATASET_PATH = path.join(__dirname, 'no-dataset-here')

const http = require('../helpers/mockHttp')
http.install()
const { scenario } = http

// ---- swap in the fake Supabase ----
const { createFakeSupabase } = require('../helpers/fakeSupabase')
const supabasePath = require.resolve('../../config/supabase')
let fake = createFakeSupabase()
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: new Proxy({}, {
  get: (_, k) => fake[k], has: (_, k) => k in fake,
}) }

// DNS: pretend every hostname used in tests is a public address (offline-safe).
const realLookup = dns.promises.lookup
dns.promises.lookup = async (host, opts) => (host === 'private.test' ? [{ address: '10.1.1.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])

const { app, isOriginAllowed } = require('../../server')

let server, base
test.before(async () => {
  await new Promise(r => { server = app.listen(0, r) })
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(() => { server.close(); dns.promises.lookup = realLookup })
test.beforeEach(() => { http.reset(); fake = createFakeSupabase() })

async function post(p, body, headers = {}) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  let json = null; try { json = await res.json() } catch (_) {}
  return { status: res.status, json, res }
}
async function get(p, headers = {}) {
  const res = await fetch(base + p, { headers })
  let json = null; try { json = await res.json() } catch (_) {}
  return { status: res.status, json, res }
}

const TEXT = 'The Reserve Bank of India raised the repo rate by 25 basis points in February 2023 to curb inflation. The decision was announced by the governor after a monetary policy meeting.'

// ── startup / health / CORS ──────────────────────────────────────────────────
test('health + root', async () => {
  assert.equal((await get('/api/health')).json.status, 'ok')
  assert.match((await get('/')).json.status, /running/)
})

test('unknown route => JSON 404', async () => {
  const r = await get('/api/nope')
  assert.equal(r.status, 404)
  assert.equal(r.json.errorCode, 'NOT_FOUND')
})

test('CORS: local dev, FRONTEND_URL (trailing slash tolerated), CORS_ORIGINS, vercel preview allowed; others blocked', () => {
  for (const o of ['http://localhost:5173', 'http://127.0.0.1:3000', 'https://app.example.vercel.app', 'https://extra.example.com', 'https://truth-lens-ai-front-abc123-team.vercel.app', undefined]) {
    assert.equal(isOriginAllowed(o), true, String(o))
  }
  for (const o of ['https://evil.com', 'https://random-app.vercel.app', 'http://localhost:9999']) {
    assert.equal(isOriginAllowed(o), false, o)
  }
})

test('CORS: preflight returns headers for allowed origin, none for blocked origin', async () => {
  const ok = await fetch(base + '/api/analyze', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } })
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const bad = await fetch(base + '/api/analyze', { method: 'OPTIONS', headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' } })
  assert.equal(bad.headers.get('access-control-allow-origin'), null)
})

test('CORS headers are present on JSON error responses (errors are not masked as CORS failures)', async () => {
  const r = await post('/api/analyze', { url: '' }, { Origin: 'http://localhost:5173' })
  assert.equal(r.status, 400)
  assert.equal(r.res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})

test('malformed JSON body => 400 INVALID_JSON; oversized => 413', async () => {
  const bad = await post('/api/analyze', '{not json')
  assert.equal(bad.status, 400); assert.equal(bad.json.errorCode, 'INVALID_JSON')
  const big = await post('/api/analyze', JSON.stringify({ url: 'a'.repeat(1_200_000) }))
  assert.equal(big.status, 413)
})

// ── /api/analyze: input handling ─────────────────────────────────────────────
test('analyze: empty input => 400', async () => {
  for (const body of [{}, { url: '' }, { url: '   ' }]) {
    const r = await post('/api/analyze', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.ok(r.json.error)
  }
})

test('analyze: invalid URL => 400, private/localhost URL => 400 (SSRF)', async () => {
  assert.equal((await post('/api/analyze', { url: 'https://nodots' })).json.errorCode, 'INVALID_URL')
  assert.equal((await post('/api/analyze', { url: 'http://localhost:10000/api/health' })).json.errorCode, 'INVALID_URL')
  assert.equal((await post('/api/analyze', { url: 'http://private.test/x' })).json.errorCode, 'INVALID_URL')
})

test('analyze: very long input => 413 with a clear message', async () => {
  const r = await post('/api/analyze', { url: 'word '.repeat(30000) })
  assert.equal(r.status, 413)
  assert.equal(r.json.errorCode, 'INPUT_TOO_LONG')
})

test('analyze: unsupported content (instagram reel, PDF link) => 422, not 500', async () => {
  const ig = await post('/api/analyze', { url: 'https://www.instagram.com/reel/Cabc123/' })
  assert.equal(ig.status, 422); assert.equal(ig.json.errorCode, 'UNSUPPORTED_CONTENT')

  scenario.pages['https://docs.example.com/report.pdf'] = { contentType: 'application/pdf', body: '%PDF-1.4' }
  const pdf = await post('/api/analyze', { url: 'https://docs.example.com/report.pdf' })
  assert.equal(pdf.status, 422); assert.equal(pdf.json.errorCode, 'UNSUPPORTED_CONTENT')
})

test('analyze: article that cannot be fetched => 422 ARTICLE_FETCH_FAILED', async () => {
  scenario.pages['https://news.example.com/blocked'] = { status: 403 }
  const r = await post('/api/analyze', { url: 'https://news.example.com/blocked' })
  assert.equal(r.status, 422); assert.equal(r.json.errorCode, 'ARTICLE_FETCH_FAILED')
})

// ── /api/analyze: classification end-to-end ──────────────────────────────────
test('analyze text: evidence supports claim => REAL with structured result', async () => {
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.prediction, 'REAL')
  assert.ok(r.json.confidence >= 50)
  assert.equal(typeof r.json.explanation, 'string')
  assert.ok(Array.isArray(r.json.matched_text) && r.json.matched_text.length > 0)
  assert.equal(r.json.matched_text[0].origin, 'event_registry')
  assert.equal(r.json.matched_text[0].stance, 'supports')
  // legacy fields the UI depends on
  assert.equal(r.json.verdict, 'Likely Credible')
  assert.equal(typeof r.json.truthScore, 'number')
  assert.ok(Array.isArray(r.json.claimVerifications))
  assert.ok(Array.isArray(r.json.matchedSources))
  assert.equal(r.json.retrievalStatus, 'ok')
})

test('analyze text: evidence contradicts claim => FAKE', async () => {
  scenario.claimVerdict = 'REFUTED'; scenario.articleStance = 'refute'
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.json.prediction, 'FAKE')
  assert.equal(r.json.verdict, 'Contradicted by Sources')
  assert.equal(r.json.matched_text[0].stance, 'contradicts')
})

test('analyze text: articles on the same topic but not addressing the claim => INCONCLUSIVE (similarity != truth)', async () => {
  scenario.claimVerdict = 'UNVERIFIED'; scenario.articleStance = 'neutral'
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.json.prediction, 'INCONCLUSIVE')
  assert.equal(r.json.verdict, 'Needs Verification')
})

test('analyze text: model verdict WITHOUT citing an article is discarded', async () => {
  scenario.claimCitesArticle = false
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.json.prediction, 'INCONCLUSIVE')
  assert.equal(r.json.claimVerifications[0].verdict, 'UNVERIFIED')
})

test('analyze text: Event Registry API error (bad key / quota) => INCONCLUSIVE and reported, not 500', async () => {
  scenario.erError = 'Invalid API key'
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.status, 200)
  assert.equal(r.json.prediction, 'INCONCLUSIVE')
  assert.match(r.json.retrievalStatus, /er_error/)
})

test('analyze text: Event Registry HTTP 500 => INCONCLUSIVE, not 500', async () => {
  scenario.erHttpStatus = 400
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.status, 200)
  assert.equal(r.json.prediction, 'INCONCLUSIVE')
})

test('analyze text: LLM completely unavailable => still 200 and INCONCLUSIVE (deterministic fallback)', async () => {
  scenario.groqOnline = false
  const r = await post('/api/analyze', { url: TEXT })
  assert.equal(r.status, 200)
  assert.equal(r.json.prediction, 'INCONCLUSIVE')
  assert.ok(r.json.explanation.length > 20)
})

test('analyze text: missing ER_API_KEY => retrieval skipped, INCONCLUSIVE, key is never hard-coded', async () => {
  const saved = process.env.ER_API_KEY
  delete process.env.ER_API_KEY
  try {
    const r = await post('/api/analyze', { url: TEXT })
    assert.equal(r.status, 200)
    assert.equal(r.json.retrievalStatus, 'er_key_missing')
    assert.equal(r.json.prediction, 'INCONCLUSIVE')
    assert.ok(!scenario.calls.some(c => c.url.includes('eventregistry')), 'must not call Event Registry without a key')
  } finally { process.env.ER_API_KEY = saved }
})

test('Event Registry: request carries the configured key and claim keywords', async () => {
  await post('/api/analyze', { url: TEXT })
  const er = scenario.calls.filter(c => c.url.includes('eventregistry'))
  assert.ok(er.length >= 2)
  assert.equal(er[0].body.apiKey, 'test-er')
  assert.ok(er[0].body.keyword.length > 0)
})

test('analyze article URL: extracts article text and analyzes it', async () => {
  const para = '<p>' + TEXT + ' Analysts said the move was widely expected by markets and economists across the country.</p>'
  scenario.pages['https://news.example.com/rbi'] = { body: `<html><head><title>RBI hikes rate</title></head><body><nav>menu</nav><article>${para}${para}</article><footer>f</footer></body></html>` }
  const r = await post('/api/analyze', { url: 'https://news.example.com/rbi' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.pipeline.sourceType, 'article')
  assert.equal(r.json.pipeline.metadata.transcriptSource, 'article_scraper')
})

test('analyze article URL: page with no readable text => 422', async () => {
  scenario.pages['https://news.example.com/empty'] = { body: '<html><body><div>hi</div></body></html>' }
  const r = await post('/api/analyze', { url: 'https://news.example.com/empty' })
  assert.equal(r.status, 422); assert.equal(r.json.errorCode, 'CONTENT_TOO_SHORT')
})

// ── YouTube paths (transcript layer stubbed; real yt-dlp checks are in the live smoke run) ──
function stubTranscript(impl) {
  const p = require.resolve('../../services/transcriptService')
  const orig = require(p).fetchTranscriptWithFallback
  require(p).fetchTranscriptWithFallback = impl
  return () => { require(p).fetchTranscriptWithFallback = orig }
}
// pipelineService destructured the function at require time, so reload it with the stub in place.
async function withTranscript(impl, fn) {
  const tsPath = require.resolve('../../services/transcriptService')
  const pipePath = require.resolve('../../services/pipelineService')
  const ctrlPath = require.resolve('../../controllers/analyzeController')
  const routePath = require.resolve('../../routes/analyze')
  const ts = require(tsPath); const orig = ts.fetchTranscriptWithFallback
  ts.fetchTranscriptWithFallback = impl
  ;[pipePath, ctrlPath, routePath].forEach(p => delete require.cache[p])
  const mini = require('express')(); mini.use(require('express').json()); mini.use('/api', require('../../routes/analyze'))
  const s = await new Promise(r => { const x = mini.listen(0, () => r(x)) })
  try { await fn(`http://127.0.0.1:${s.address().port}`) } finally {
    s.close(); ts.fetchTranscriptWithFallback = orig
    ;[pipePath, ctrlPath, routePath].forEach(p => delete require.cache[p])
  }
}
async function postTo(b, body) { const r = await fetch(b + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() } }

test('youtube with captions => analysed with caption transcript', async () => {
  await withTranscript(async () => ({ transcript: TEXT + ' ' + TEXT, transcriptSource: 'youtube-manual-captions', languageDetected: 'en', transcriptConfidence: 98, fallbackUsed: false }),
    async (b) => {
      const r = await postTo(b, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
      assert.equal(r.status, 200, JSON.stringify(r.json))
      assert.equal(r.json.pipeline.metadata.transcriptSource, 'youtube-manual-captions')
      assert.equal(r.json.prediction, 'REAL')
    })
})

test('youtube without captions => Whisper fallback result is used and disclosed', async () => {
  await withTranscript(async () => ({ transcript: TEXT + ' ' + TEXT, transcriptSource: 'whisper-ai-fallback', languageDetected: 'en', transcriptConfidence: 88, fallbackUsed: true, audioQuality: 'high' }),
    async (b) => {
      const r = await postTo(b, { url: 'https://youtu.be/dQw4w9WgXcQ' })
      assert.equal(r.status, 200)
      assert.equal(r.json.pipeline.metadata.fallbackUsed, true)
      assert.match(r.json.explanation, /./)
    })
})

test('youtube title-only fallback => confidence is capped', async () => {
  await withTranscript(async () => ({ transcript: 'Title: ' + TEXT + '\nAuthor/Publisher: X\nVideo URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ', transcriptSource: 'youtube-oembed-metadata', languageDetected: 'en', transcriptConfidence: 30, fallbackUsed: true, metadataOnly: true }),
    async (b) => {
      const r = await postTo(b, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
      assert.equal(r.status, 200)
      assert.ok(r.json.confidence <= 40)
    })
})

test('youtube transcription failure => 422 TRANSCRIPT_UNAVAILABLE with guidance', async () => {
  await withTranscript(async () => { throw Object.assign(new Error('Unable to extract a transcript'), { errorCode: 'TRANSCRIPT_UNAVAILABLE', status: 422 }) },
    async (b) => {
      const r = await postTo(b, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
      assert.equal(r.status, 422); assert.equal(r.json.errorCode, 'TRANSCRIPT_UNAVAILABLE'); assert.ok(r.json.suggestion)
    })
})

test('youtube: yt-dlp missing => 503 YTDLP_MISSING (clear, not generic 500)', async () => {
  await withTranscript(async () => { throw Object.assign(new Error('yt-dlp is not available'), { errorCode: 'YTDLP_MISSING', status: 500 }) },
    async (b) => {
      const r = await postTo(b, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
      assert.equal(r.json.errorCode, 'YTDLP_MISSING')
      assert.ok(r.status === 500 || r.status === 503)
    })
})

// ── database-backed routes (in-memory fake) ──────────────────────────────────
async function signup(extra = {}) {
  return post('/api/auth/signup', { name: 'Tester', email: 'T@Example.com', password: 'secret123', ...extra })
}

test('auth: signup, duplicate, login, wrong password, validation', async () => {
  const s = await signup()
  assert.equal(s.status, 201); assert.ok(s.json.token); assert.equal(s.json.user.email, 't@example.com')
  assert.ok(!('password' in s.json.user))
  assert.equal((await signup()).status, 409)
  assert.equal((await post('/api/auth/signup', { name: 'a', email: 'bad', password: 'secret123' })).status, 400)
  assert.equal((await post('/api/auth/signup', { name: 'a', email: 'a@b.co', password: '123' })).status, 400)
  const ok = await post('/api/auth/login', { email: 't@example.com', password: 'secret123' })
  assert.equal(ok.status, 200); assert.ok(ok.json.token)
  assert.equal((await post('/api/auth/login', { email: 't@example.com', password: 'nope' })).status, 401)
  assert.equal((await post('/api/auth/login', { email: 'x@example.com', password: 'nope' })).status, 401)
})

test('auth: profile requires a valid token and reports real stats', async () => {
  assert.equal((await get('/api/auth/profile')).status, 401)
  assert.equal((await get('/api/auth/profile', { Authorization: 'Bearer garbage' })).status, 401)
  const { json } = await signup()
  const auth = { Authorization: 'Bearer ' + json.token }
  await post('/api/reports/save', { videoUrl: 'https://example.com/a1', truthScore: 80, summary: 's' }, auth)
  await post('/api/reports/save', { videoUrl: 'https://example.com/a2', truthScore: 20, summary: 's' }, auth)
  const p = await get('/api/auth/profile', auth)
  assert.equal(p.status, 200)
  assert.equal(p.json.stats.reportCount, 2)
  assert.equal(p.json.stats.avgScore, 50)
  assert.equal(p.json.stats.trusted, 1)
  assert.equal(p.json.stats.highRisk, 1)
})

test('reports: save (upsert), history, delete with ownership', async () => {
  const a = await signup(); const b = await post('/api/auth/signup', { name: 'B', email: 'b@example.com', password: 'secret123' })
  const ha = { Authorization: 'Bearer ' + a.json.token }, hb = { Authorization: 'Bearer ' + b.json.token }
  assert.equal((await post('/api/reports/save', { videoUrl: 'https://example.com/x', truthScore: 70 })).status, 401)
  assert.equal((await post('/api/reports/save', { videoUrl: '', truthScore: 70 }, ha)).status, 400)
  assert.equal((await post('/api/reports/save', { videoUrl: 'https://example.com/x', truthScore: 'high' }, ha)).status, 400)
  const saved = await post('/api/reports/save', { videoUrl: 'https://example.com/x', truthScore: 70, summary: 's' }, ha)
  assert.equal(saved.status, 200)
  await post('/api/reports/save', { videoUrl: 'https://example.com/x', truthScore: 75, summary: 's2' }, ha) // upsert, same row
  const hist = await get('/api/reports/history', ha)
  assert.equal(hist.json.reports.length, 1); assert.equal(hist.json.reports[0].truthScore, 75)
  assert.equal((await get('/api/reports/history', hb)).json.reports.length, 0)
  const id = hist.json.reports[0]._id
  const del = (tok) => fetch(`${base}/api/reports/${id}`, { method: 'DELETE', headers: tok })
  assert.equal((await del(hb)).status, 404)           // other user cannot delete it
  assert.equal((await del(ha)).status, 200)
  assert.equal((await get('/api/reports/history', ha)).json.reports.length, 0)
})

test('flags: validation, create, duplicate, count, list', async () => {
  const f = { videoUrl: 'https://example.com/v', reasons: ['misleading'], userId: 'anon-1', truthScore: 10 }
  assert.equal((await post('/api/flags', { ...f, reasons: [] })).status, 400)
  assert.equal((await post('/api/flags', { ...f, userId: undefined })).status, 400)
  assert.equal((await post('/api/flags', f)).status, 201)
  assert.equal((await post('/api/flags', f)).status, 409)
  assert.equal((await post('/api/flags', { ...f, userId: 'anon-2' })).json.communityCount, 2)
  const c = await get('/api/flags/count?url=' + encodeURIComponent(f.videoUrl) + '&userId=anon-1')
  assert.equal(c.json.count, 2); assert.equal(c.json.userFlagged, true)
  assert.equal((await get('/api/flags')).json.total, 2)
})

test('admin dashboard: real aggregates from analyses/flags (no fabricated numbers)', async () => {
  const empty = await get('/api/admin/dashboard')
  assert.equal(empty.status, 200)
  assert.equal(empty.json.totalAnalyses, 0)
  assert.equal(empty.json.fakeNewsDetected, 0)
  assert.equal(empty.json.scoreDistribution.length, 10)

  await post('/api/analyze', { url: TEXT })                       // REAL
  scenario.claimVerdict = 'REFUTED'; scenario.articleStance = 'refute'
  await post('/api/analyze', { url: TEXT + ' Extra sentence.' })  // FAKE
  await new Promise(r => setTimeout(r, 50))                       // analysis log is fire-and-forget
  await post('/api/flags', { videoUrl: 'https://example.com/v', reasons: ['fake'], userId: 'u1' })

  const d = await get('/api/admin/dashboard')
  assert.equal(d.json.totalAnalyses, 2)
  assert.equal(d.json.fakeNewsDetected, 1)
  assert.equal(d.json.trustedContent, 1)
  assert.equal(d.json.activeAlerts, 1)
  assert.equal(d.json.recentActivities.length, 2)
  assert.equal(d.json.dailyActivity.length, 14)
})

test('database not configured => 503 DB_NOT_CONFIGURED (not a vague 500)', async () => {
  fake = { ...createFakeSupabase(), isConfigured: false }
  const r = await post('/api/auth/login', { email: 'a@b.co', password: 'x' })
  assert.equal(r.status, 503); assert.equal(r.json.errorCode, 'DB_NOT_CONFIGURED')
  assert.equal((await get('/api/flags')).status, 503)
  // analyze must keep working without a database
  assert.equal((await post('/api/analyze', { url: TEXT })).status, 200)
})

// ── chat / translate ─────────────────────────────────────────────────────────
test('chat: answers with and without analysis context; empty question => 400', async () => {
  assert.equal((await post('/api/chat', { message: '' })).status, 400)
  const noCtx = await post('/api/chat', { message: 'What is TruthLens?' })
  assert.equal(noCtx.status, 200); assert.ok(noCtx.json.reply)
  const withCtx = await post('/api/chat', { message: 'Why this verdict?', analysisContext: { summary: 's', prediction: 'FAKE', truthScore: 20 } })
  assert.equal(withCtx.json.reply, 'Mock chat answer.')
})

test('chat: LLM down => graceful fallback reply, still 200', async () => {
  scenario.groqOnline = false
  const r = await post('/api/chat', { message: 'Why?', analysisContext: { summary: 's', truthScore: 20 } })
  assert.equal(r.status, 200); assert.match(r.json.reply, /Truth Score/)
})

test('translate: validation, English passthrough, shape-preserving translation, fallback on failure', async () => {
  assert.equal((await post('/api/translate', {})).status, 400)
  assert.equal((await post('/api/translate', { payload: { summary: 'hello' }, targetLang: 'xx' })).status, 400)
  assert.equal((await post('/api/translate', { payload: { summary: 'hello' }, targetLang: 'en' })).json.translated.summary, 'hello')

  const payload = { summary: 'The bank raised rates.', key_points: ['First point', null, 'Third point'], explanation: null, claims: [] }
  const hi = (await post('/api/translate', { payload, targetLang: 'hi' })).json.translated
  assert.equal(hi.summary, 'अनुवादित The bank raised rates.')
  assert.deepEqual(hi.key_points, ['अनुवादित First point', null, 'अनुवादित Third point'])   // nulls and array length preserved
  assert.equal(hi.explanation, null)
  assert.deepEqual(hi.claims, [])

  // chat history uses a "messages" key: it must be translated too (the old endpoint silently skipped unknown keys)
  const chat = (await post('/api/translate', { payload: { messages: [null, 'Assistant reply'] }, targetLang: 'te' })).json.translated
  assert.equal(chat.messages[0], null); assert.match(chat.messages[1], /Assistant reply/)

  scenario.groqOnline = false
  const down = await post('/api/translate', { payload: { summary: 'brand new text' }, targetLang: 'ta' })
  assert.equal(down.status, 200); assert.equal(down.json.translated.summary, 'brand new text')
})

// ── live news ────────────────────────────────────────────────────────────────
test('live news: real feed parsed, de-duplicated, newest first, validated params', async () => {
  const feed = require('../../services/liveNewsFeedService'); feed._clearCache()
  const savedKey = process.env.ER_API_KEY; delete process.env.ER_API_KEY   // Google News only, so counts are exact
  const r = await get('/api/news/live?lang=hi&category=politics&limit=10')
  process.env.ER_API_KEY = savedKey
  assert.equal(r.status, 200)
  assert.equal(r.json.items.length, 2, 'duplicate headline removed')
  assert.equal(r.json.items[0].headline, 'Rates rise again')
  assert.equal(r.json.items[0].source, 'Reuters')
  assert.ok(new Date(r.json.items[0].publishedAt) > new Date(r.json.items[1].publishedAt))
  assert.ok(scenario.calls.some(c => c.url.includes('hl=hi')), 'Hindi edition requested')
  assert.equal(r.json.cached, false)
  assert.equal((await get('/api/news/live?lang=hi&category=politics&limit=10')).json.cached, true)   // 60 s cache
  const bad = await get('/api/news/live?lang=zz&category=nope&limit=999')
  assert.equal(bad.status, 200)                                                                    // invalid params fall back safely
})

test('live news: provider outage => 503 NEWS_UNAVAILABLE (no fake headlines)', async () => {
  require('../../services/liveNewsFeedService')._clearCache()
  scenario.rssError = true
  delete process.env.ER_API_KEY
  try {
    const r = await get('/api/news/live?lang=en&category=ai')
    assert.equal(r.status, 503); assert.equal(r.json.errorCode, 'NEWS_UNAVAILABLE')
  } finally { process.env.ER_API_KEY = 'test-er' }
})

// ── summary ──────────────────────────────────────────────────────────────────
test('summary fallback is extractive: real sentences only, numbers kept, no template text', async () => {
  const { generateFallbackSummary } = require('../../services/cleanSummaryEngine')
  const text = 'So the Reserve Bank of India raised the repo rate by 25 basis points on 8 February 2023. Governor Shaktikanta Das said inflation remains above the target band. Markets had widely expected the move. Economists said further hikes were possible. The rupee was largely flat. Retail inflation stood at 6.52 percent in January, above the 6 percent upper limit.'
  const r = generateFallbackSummary(text, {})
  assert.ok(r.cleanSummary.includes('25 basis points'))
  assert.ok(r.cleanSummary.includes('6.52 percent'), 'decimal numbers must not be split into sentences')
  assert.ok(!/This video discusses|surrounding/i.test(r.cleanSummary))
  for (const s of r.cleanSummary.split(/(?<=\.)\s+/)) assert.ok(text.includes(s.replace(/\.$/, '')), 'every sentence comes from the source')
  assert.ok(r.keyPoints.length >= 1)
})
