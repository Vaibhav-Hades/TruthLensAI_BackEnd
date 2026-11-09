/**
 * classificationService.js
 *
 * Deterministic, explainable final classification: REAL | FAKE | MISLEADING | INCONCLUSIVE.
 *
 * Design rules
 *  - Similarity never decides a verdict. A highly similar article only means "same topic".
 *  - Only per-claim stance evidence (SUPPORTED / REFUTED, produced by comparing a claim to
 *    retrieved articles) moves the verdict.
 *  - Reference-dataset matches are context. The one exception is a near-duplicate of an item
 *    the dataset labels as fake, which counts as (weak) refuting evidence. A near-duplicate
 *    of a "real" item is NEVER treated as support.
 *  - Not enough evidence => INCONCLUSIVE, never a guess.
 */

const NEAR_DUPLICATE_SIMILARITY = 0.85
const REFERENCE_FAKE_WEIGHT = 45     // confidence-equivalent weight of a near-duplicate fake match
const MIN_DECISIVE_CONFIDENCE = 55   // a stance below this is treated as weak

const LEGACY_VERDICT = {
  REAL: 'Likely Credible',
  MISLEADING: 'Partially Verified',
  FAKE: 'Contradicted by Sources',
  INCONCLUSIVE: 'Needs Verification',
}

function normaliseVerdict(v) {
  const s = String(v || '').trim().toUpperCase()
  if (s.startsWith('SUPPORT')) return 'SUPPORTED'
  if (s.startsWith('REFUT') || s.startsWith('CONTRADICT')) return 'REFUTED'
  return 'UNVERIFIED'
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }

/**
 * @param {Object}   input
 * @param {Array}    input.claimVerifications  [{claim, verdict, confidence, evidence, reasoning}]
 * @param {Array}    [input.referenceMatches]  [{label:'real'|'fake', similarity, title, text}]
 * @param {Object}   [input.context]           {metadataOnly, retrievalStatus}
 */
function classify({ claimVerifications = [], referenceMatches = [], context = {} } = {}) {
  const claims = claimVerifications.map(c => ({
    ...c,
    verdict: normaliseVerdict(c.verdict),
    confidence: clamp(Number(c.confidence) || 0, 0, 100),
  }))

  const supported = claims.filter(c => c.verdict === 'SUPPORTED')
  const refuted = claims.filter(c => c.verdict === 'REFUTED')
  const unverified = claims.filter(c => c.verdict === 'UNVERIFIED')

  const supportW = supported.reduce((s, c) => s + c.confidence, 0)
  let refuteW = refuted.reduce((s, c) => s + c.confidence, 0)

  // Reference dataset: only a near-duplicate of a FAKE-labelled item counts, and only as weak evidence.
  const fakeDuplicates = referenceMatches.filter(
    m => String(m.label).toLowerCase() === 'fake' && Number(m.similarity) >= NEAR_DUPLICATE_SIMILARITY
  )
  if (fakeDuplicates.length) refuteW += REFERENCE_FAKE_WEIGHT

  const decided = supported.length + refuted.length + (fakeDuplicates.length ? 1 : 0)
  const totalClaims = claims.length
  const signals = {
    totalClaims,
    supported: supported.length,
    refuted: refuted.length,
    unverified: unverified.length,
    referenceFakeDuplicates: fakeDuplicates.length,
    supportWeight: supportW,
    refuteWeight: refuteW,
  }

  let prediction
  let reason

  if (decided === 0) {
    prediction = 'INCONCLUSIVE'
    reason = totalClaims === 0
      ? 'No checkable factual claims were found in the submitted content.'
      : context.retrievalStatus && context.retrievalStatus !== 'ok'
        ? `Live news evidence could not be retrieved (${context.retrievalStatus}), so the claims could not be checked.`
        : 'Trusted reporting did not directly confirm or contradict any of the extracted claims.'
  } else {
    const refuteShare = refuteW / (supportW + refuteW)
    const strongRefute = refuted.some(c => c.confidence >= MIN_DECISIVE_CONFIDENCE) || fakeDuplicates.length > 0
    const supportedFraction = totalClaims ? supported.length / totalClaims : 0

    if (refuteShare >= 0.66 && strongRefute) {
      prediction = 'FAKE'
      reason = 'The main claims are contradicted by retrieved reporting' +
        (fakeDuplicates.length ? ' and the text closely matches an item labelled fake in the reference dataset.' : '.')
    } else if (refuteShare <= 0.15 && supportedFraction >= 0.5 && supportW / Math.max(1, supported.length) >= MIN_DECISIVE_CONFIDENCE) {
      prediction = 'REAL'
      reason = 'The majority of the claims are directly confirmed by retrieved reporting and none are materially contradicted.'
    } else if (refuted.length === 0 && supported.length > 0) {
      prediction = 'INCONCLUSIVE'
      reason = 'Some claims are supported, but too few were verified to judge the content as a whole.'
    } else {
      prediction = 'MISLEADING'
      reason = 'The evidence is mixed: some claims are supported while others are contradicted or distorted.'
    }
  }

  // Confidence = how sure we are in `prediction`, not "how true".
  let confidence
  if (prediction === 'INCONCLUSIVE') {
    confidence = decided === 0 ? 20 : clamp(25 + decided * 5, 0, 45)
  } else {
    const side = prediction === 'FAKE' ? refuted : prediction === 'REAL' ? supported : [...supported, ...refuted]
    const avg = side.length ? side.reduce((s, c) => s + c.confidence, 0) / side.length : REFERENCE_FAKE_WEIGHT
    const coverage = totalClaims ? Math.min(1, decided / totalClaims) : 0.5
    confidence = Math.round(avg * (0.6 + 0.4 * coverage))
  }
  if (context.metadataOnly) confidence = Math.min(confidence, 40) // only a title was analysed
  confidence = clamp(Math.round(confidence), 0, 100)

  // Legacy 0-100 "truth score" for the existing UI gauge: 50 = no evidence either way.
  let truthScore = 50
  if (supportW + refuteW > 0) {
    const balance = (supportW - refuteW) / (supportW + refuteW)
    truthScore = Math.round(50 + 50 * balance * (confidence / 100 * 0.5 + 0.5))
  }
  if (prediction === 'INCONCLUSIVE') truthScore = clamp(truthScore, 35, 55)
  truthScore = clamp(truthScore, 0, 100)

  return {
    prediction,
    confidence,
    truthScore,
    reason,
    legacyVerdict: LEGACY_VERDICT[prediction],
    signals,
  }
}

module.exports = { classify, normaliseVerdict, LEGACY_VERDICT, NEAR_DUPLICATE_SIMILARITY }
