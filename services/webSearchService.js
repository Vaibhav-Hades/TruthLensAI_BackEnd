/**
 * webSearchService.js — keyless news retrieval ("search the web, no API key").
 *
 * Uses the public Bing News RSS feed (real publisher URLs, snippets, source names and dates), then
 * optionally reads the article pages themselves so claims can be checked against real text.
 * Used automatically when ER_API_KEY is not set, or when Event Registry fails / finds nothing.
 */
const axios = require('axios')
const { assertPublicUrl } = require('../utils/inputValidation')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const MARKETS = { eng: 'en-IN', hin: 'hi-IN', tel: 'te-IN', tam: 'ta-IN' }

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}
const strip = (s) => decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return m ? m[1] : '' }

/** Bing wraps the publisher URL in an apiclick redirect: ...&url=<encoded real url>. */
function realUrl(link) {
  const l = decodeEntities(link).trim()
  const m = l.match(/[?&]url=([^&]+)/i)
  if (m) { try { return decodeURIComponent(m[1]) } catch (_) { /* fall through */ } }
  return l
}

function parseBingRss(xml) {
  return String(xml).split(/<item>/i).slice(1).map(b => {
    const url = realUrl(tag(b, 'link'))
    let host = ''
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch (_) { return null }
    const date = tag(b, 'pubDate').trim()
    const t = date ? new Date(date) : null
    return {
      title: strip(tag(b, 'title')),
      url,
      source: strip(tag(b, 'News:Source')) || host,
      domain: host,
      body: strip(tag(b, 'description')),   // publisher snippet
      image: null,
      publishDate: t && !isNaN(t) ? t.toISOString() : null,
      provider: 'web-search',
    }
  }).filter(a => a && a.title && /^https?:/.test(a.url))
}

/**
 * @param {string[]} keywords
 * @param {'and'|'or'} oper
 * @param {string} lang  ER-style language code (eng|hin|tel|tam)
 */
async function searchNews(keywords, oper = 'and', lang = 'eng', count = 10) {
  const terms = (keywords || []).map(k => String(k).trim()).filter(Boolean)
  if (!terms.length) return []
  const q = terms.map(t => (/\s/.test(t) ? `"${t}"` : t)).join(oper === 'or' ? ' OR ' : ' ')
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=${(MARKETS[lang] || 'en-IN').split('-')[0]}&mkt=${MARKETS[lang] || 'en-IN'}`
  const res = await axios.get(url, { timeout: 10000, responseType: 'text', transformResponse: [d => d], headers: { 'User-Agent': UA } })
  return parseBingRss(res.data).slice(0, count)
}

/** Reads the real article text for the first `max` results (best effort; falls back to the snippet). */
async function enrichBodies(articles, max = 3, maxChars = 1800) {
  const out = articles.map(a => ({ ...a }))
  await Promise.all(out.slice(0, max).map(async (a) => {
    try {
      await assertPublicUrl(a.url)
      const res = await axios.get(a.url, {
        timeout: 8000, maxRedirects: 3, maxContentLength: 3 * 1024 * 1024, responseType: 'text', transformResponse: [d => d],
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8' },
      })
      if (!/html/i.test(String(res.headers['content-type'] || ''))) return
      const html = String(res.data)
        .replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|nav|footer|header|aside|form|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, '')
      const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => strip(m[1])).filter(t => t.length > 60)
      const text = paras.join(' ').slice(0, maxChars)
      if (text.length > 200) { a.body = text; a.bodyFrom = 'page' }
    } catch (_) { /* keep the snippet */ }
  }))
  return out
}

module.exports = { searchNews, enrichBodies, parseBingRss, realUrl }
