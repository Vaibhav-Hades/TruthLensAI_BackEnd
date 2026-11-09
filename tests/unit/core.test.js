const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { classify } = require('../../services/classificationService')
const { embedText, cosineSimilarity } = require('../../services/embeddingService')
const ref = require('../../services/referenceDatasetService')
const { validateAnalyzeInput, assertPublicUrl } = require('../../utils/inputValidation')
const { detectInputType } = require('../../services/inputDetector')

const sup = (c = 85) => ({ claim: 'c', verdict: 'SUPPORTED', confidence: c })
const ref_ = (c = 85) => ({ claim: 'c', verdict: 'REFUTED', confidence: c })
const unv = () => ({ claim: 'c', verdict: 'UNVERIFIED', confidence: 0 })

// ── classification ───────────────────────────────────────────────────────────
test('classify: all claims supported => REAL', () => {
  const r = classify({ claimVerifications: [sup(), sup()] })
  assert.equal(r.prediction, 'REAL')
  assert.ok(r.confidence >= 60)
  assert.ok(r.truthScore >= 70)
})

test('classify: main claims refuted => FAKE', () => {
  const r = classify({ claimVerifications: [ref_(), ref_()] })
  assert.equal(r.prediction, 'FAKE')
  assert.ok(r.truthScore <= 30)
})

test('classify: mixed supported/refuted => MISLEADING', () => {
  const r = classify({ claimVerifications: [sup(), ref_(80)] })
  assert.equal(r.prediction, 'MISLEADING')
})

test('classify: no claims / nothing verifiable => INCONCLUSIVE with low confidence', () => {
  for (const claimVerifications of [[], [unv(), unv()]]) {
    const r = classify({ claimVerifications })
    assert.equal(r.prediction, 'INCONCLUSIVE')
    assert.ok(r.confidence <= 30)
    assert.equal(r.truthScore, 50)
  }
})

test('classify: one supported claim out of four is NOT enough for REAL', () => {
  const r = classify({ claimVerifications: [sup(), unv(), unv(), unv()] })
  assert.equal(r.prediction, 'INCONCLUSIVE')
})

test('classify: retrieval failure is reported in the reason', () => {
  const r = classify({ claimVerifications: [unv()], context: { retrievalStatus: 'er_key_missing' } })
  assert.equal(r.prediction, 'INCONCLUSIVE')
  assert.match(r.reason, /er_key_missing/)
})

test('classify: SIMILARITY ALONE never produces REAL (very similar "real" reference item)', () => {
  const r = classify({ claimVerifications: [unv()], referenceMatches: [{ label: 'real', similarity: 0.99 }] })
  assert.notEqual(r.prediction, 'REAL')
  assert.equal(r.prediction, 'INCONCLUSIVE')
})

test('classify: near-duplicate of a FAKE reference item counts as (weak) refuting evidence', () => {
  const r = classify({ claimVerifications: [unv()], referenceMatches: [{ label: 'fake', similarity: 0.95 }] })
  assert.equal(r.prediction, 'FAKE')
  assert.ok(r.confidence <= 60, 'weak evidence must not give high confidence')
})

test('classify: low-similarity fake reference match is ignored', () => {
  const r = classify({ claimVerifications: [unv()], referenceMatches: [{ label: 'fake', similarity: 0.5 }] })
  assert.equal(r.prediction, 'INCONCLUSIVE')
})

test('classify: title-only analysis caps confidence', () => {
  const r = classify({ claimVerifications: [sup(), sup()], context: { metadataOnly: true } })
  assert.ok(r.confidence <= 40)
})

// ── embeddings ───────────────────────────────────────────────────────────────
test('embedding: deterministic, unit length, 512 dims', () => {
  const a = embedText('The central bank raised interest rates to curb inflation.')
  const b = embedText('The central bank raised interest rates to curb inflation.')
  assert.deepEqual(a, b)
  assert.equal(a.length, 512)
  assert.ok(Math.abs(Math.sqrt(a.reduce((s, v) => s + v * v, 0)) - 1) < 1e-9)
})

test('embedding: related text scores higher than unrelated text', () => {
  const a = embedText('The central bank announced a rise in interest rates to curb inflation this quarter.')
  const related = embedText('Central bank raises interest rates to fight inflation, officials said this quarter.')
  const unrelated = embedText('Scientists discovered a new species of deep sea fish near volcanic vents in the Pacific.')
  assert.ok(cosineSimilarity(a, related) > cosineSimilarity(a, unrelated) + 0.25)
})

test('embedding: non-Latin scripts are embedded (old [a-z]-only tokenizer produced nothing)', () => {
  const hi1 = embedText('भारत सरकार ने नई शिक्षा नीति की घोषणा की')
  const hi2 = embedText('सरकार ने शिक्षा नीति की घोषणा की है')
  assert.ok(hi1.some(v => v !== 0))
  assert.ok(cosineSimilarity(hi1, hi2) > 0.3)
})

test('embedding: empty / invalid input gives a zero vector, no throw', () => {
  assert.ok(embedText('').every(v => v === 0))
  assert.ok(embedText(null).every(v => v === 0))
})

// ── reference dataset ────────────────────────────────────────────────────────
test('reference dataset: loads Kaggle-style True.csv/Fake.csv and matches by similarity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl_ref_'))
  fs.writeFileSync(path.join(dir, 'True.csv'), 'title,text,subject,date\n"Senate passes budget bill","The US Senate passed the federal budget bill on Tuesday after a long debate, with ""amendments"" added.",politics,2017\n')
  fs.writeFileSync(path.join(dir, 'Fake.csv'), 'title,text,subject,date\n"Aliens endorse candidate","Unnamed sources say aliens landed and endorsed the presidential candidate in a secret meeting.",politics,2017\n')
  ref._reset()
  const status = (ref.loadReferenceDataset(dir), ref.getStatus())
  assert.equal(status.items, 2)
  const m = ref.findReferenceMatches('Aliens landed and endorsed the presidential candidate in a secret meeting, sources say')
  assert.equal(m[0].label, 'fake')
  assert.equal(m[0].origin, 'reference_dataset')
  fs.rmSync(dir, { recursive: true, force: true })
  ref._reset()
})

test('reference dataset: missing dataset is not an error', () => {
  ref._reset()
  ref.loadReferenceDataset(path.join(os.tmpdir(), 'tl_does_not_exist'))
  assert.equal(ref.getStatus().available, false)
  assert.deepEqual(ref.findReferenceMatches('anything at all here'), [])
  ref._reset()
})

// ── input validation / detection ─────────────────────────────────────────────
test('validate: empty, whitespace, null, non-string', () => {
  for (const v of ['', '   ', null, undefined, 42, {}]) {
    assert.throws(() => validateAnalyzeInput(v), (e) => e.status === 400)
  }
})

test('validate: very long input => 413 INPUT_TOO_LONG', () => {
  assert.throws(() => validateAnalyzeInput('a'.repeat(100001)), (e) => e.status === 413 && e.errorCode === 'INPUT_TOO_LONG')
})

test('validate: invalid URLs rejected, valid URLs and text accepted', () => {
  assert.throws(() => validateAnalyzeInput('http://'), (e) => e.errorCode === 'INVALID_URL')
  assert.throws(() => validateAnalyzeInput('https://nodots'), (e) => e.errorCode === 'INVALID_URL')
  assert.throws(() => validateAnalyzeInput('ftp://example.com/file'), (e) => e.errorCode === 'UNSUPPORTED_CONTENT')
  assert.deepEqual(validateAnalyzeInput('https://example.com/news'), { input: 'https://example.com/news', kind: 'url' })
  assert.equal(validateAnalyzeInput('www.example.com/news/story').input, 'https://www.example.com/news/story')
  assert.equal(validateAnalyzeInput('This is a perfectly normal claim to verify.').kind, 'text')
})

test('SSRF guard blocks localhost / private addresses', async () => {
  for (const u of ['http://localhost:3000/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://169.254.169.254/latest', 'http://[::1]/x']) {
    await assert.rejects(() => assertPublicUrl(u), (e) => e.errorCode === 'INVALID_URL', u)
  }
})

test('input detector: youtube / instagram / article / text', () => {
  assert.equal(detectInputType('https://www.youtube.com/watch?v=dQw4w9WgXcQ').type, 'video')
  assert.equal(detectInputType('https://youtu.be/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ')
  assert.equal(detectInputType('https://www.instagram.com/reel/abc/').videoId, undefined)
  assert.equal(detectInputType('https://example.com/a').type, 'article')
  assert.equal(detectInputType('just some words here').type, 'text')
})
