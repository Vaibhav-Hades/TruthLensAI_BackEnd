/**
 * inputValidation.js — validates /api/analyze input and guards article fetching (SSRF).
 */
const dns = require('dns').promises
const net = require('net')

const MAX_INPUT_CHARS = parseInt(process.env.MAX_INPUT_CHARS || '100000', 10)
const MIN_TEXT_CHARS = 20

function appError(message, errorCode, status, extra = {}) {
  return Object.assign(new Error(message), { errorCode, status, ...extra })
}

/** Looks like the user meant a URL (scheme, www., or domain/path with no spaces). */
function looksLikeUrl(s) {
  if (/\s/.test(s)) return false
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^www\./i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(s)
}

/**
 * @returns {{input:string, kind:'url'|'text'}} trimmed input, or throws an error carrying status/errorCode.
 */
function validateAnalyzeInput(raw) {
  if (raw === undefined || raw === null || typeof raw !== 'string') {
    throw appError('Content input is required.', 'INVALID_INPUT', 400)
  }
  const input = raw.trim()
  if (!input) throw appError('Content input is required.', 'EMPTY_INPUT', 400)
  if (input.length > MAX_INPUT_CHARS) {
    throw appError(`Input is too long (${input.length.toLocaleString()} characters). The limit is ${MAX_INPUT_CHARS.toLocaleString()}.`, 'INPUT_TOO_LONG', 413)
  }

  if (looksLikeUrl(input)) {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : 'https://' + input
    let u
    try { u = new URL(candidate) } catch (_) {
      throw appError('That does not look like a valid URL.', 'INVALID_URL', 400)
    }
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw appError('Only http(s) links are supported.', 'UNSUPPORTED_CONTENT', 422)
    }
    if (!u.hostname.includes('.') && !net.isIP(u.hostname)) {
      throw appError('That does not look like a valid URL.', 'INVALID_URL', 400)
    }
    return { input: candidate, kind: 'url' }
  }

  if (input.length < MIN_TEXT_CHARS) {
    throw appError(`Please enter at least ${MIN_TEXT_CHARS} characters of text to analyze.`, 'INPUT_TOO_SHORT', 400)
  }
  return { input, kind: 'text' }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:')
  }
  return true
}

/** Throws if the URL points at localhost / a private network (prevents server-side request forgery). */
async function assertPublicUrl(urlString) {
  const u = new URL(urlString)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^localhost$/i.test(host) || /\.(local|internal|localhost)$/i.test(host)) {
    throw appError('That address is not publicly reachable.', 'INVALID_URL', 400)
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw appError('That address is not publicly reachable.', 'INVALID_URL', 400)
    return
  }
  try {
    const addrs = await dns.lookup(host, { all: true })
    if (addrs.some(a => isPrivateIp(a.address))) throw appError('That address is not publicly reachable.', 'INVALID_URL', 400)
  } catch (err) {
    if (err.errorCode) throw err
    throw appError('Could not resolve that website. Check the link and try again.', 'ARTICLE_FETCH_FAILED', 422)
  }
}

module.exports = { validateAnalyzeInput, assertPublicUrl, appError, looksLikeUrl, MAX_INPUT_CHARS, MIN_TEXT_CHARS }
