/**
 * liveNewsFeedService.js — real, current headlines (no mock data).
 *
 * Sources
 *  - Google News RSS (no key needed; native-language editions for en/hi/te/ta)
 *  - Event Registry (only when ER_API_KEY is set; adds article snippets and images)
 * Results are merged, de-duplicated, sorted newest-first and cached for CACHE_MS so many
 * browsers polling every minute cost one upstream request per language/category.
 */
const axios = require('axios')

const CACHE_MS = parseInt(process.env.LIVE_NEWS_CACHE_MS || '60000', 10)
const cache = new Map() // key -> { at, items }

const EDITIONS = {
  en: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en', er: 'eng' },
  hi: { hl: 'hi', gl: 'IN', ceid: 'IN:hi', er: 'hin' },
  te: { hl: 'te', gl: 'IN', ceid: 'IN:te', er: 'tel' },
  ta: { hl: 'ta', gl: 'IN', ceid: 'IN:ta', er: 'tam' },
}

// Category -> search query (English queries work on all editions; Google localises results).
const CATEGORY_QUERIES = {
  all: 'India OR world OR technology OR economy',
  politics: 'politics OR election OR government',
  technology: 'technology OR software OR gadgets',
  global: 'world news OR international',
  ai: 'artificial intelligence OR AI',
  misinfo: 'fact check OR misinformation OR deepfake',
  economics: 'economy OR markets OR inflation OR business',
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

function stripTags(s) { return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : ''
}

/** Parses a Google News RSS document into items. Exported for tests. */
function parseRss(xml, lang, category) {
  const items = []
  const blocks = String(xml).split(/<item>/i).slice(1)
  for (const b of blocks) {
    let title = stripTags(tag(b, 'title'))
    const link = decodeEntities(tag(b, 'link')).trim()
    const pub = tag(b, 'pubDate').trim()
    const srcMatch = b.match(/<source[^>]*>([\s\S]*?)<\/source>/i)
    let source = srcMatch ? stripTags(srcMatch[1]) : ''
    // Google appends " - Source" to titles.
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3)).trim()
    else if (!source) { const i = title.lastIndexOf(' - '); if (i > 0) { source = title.slice(i + 3); title = title.slice(0, i) } }
    const t = pub ? new Date(pub) : null
    if (!title || !link) continue
    items.push({
      id: link,
      headline: title,
      source: source || 'News',
      url: link,
      publishedAt: t && !isNaN(t) ? t.toISOString() : null,
      summary: '',
      image: null,
      category,
      lang,
      provider: 'google-news',
    })
  }
  return items
}

async function fetchGoogleNews(lang, category, limit) {
  const ed = EDITIONS[lang] || EDITIONS.en
  const q = encodeURIComponent((CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all) + ' when:1d')
  const url = `https://news.google.com/rss/search?q=${q}&hl=${ed.hl}&gl=${ed.gl}&ceid=${ed.ceid}`
  const res = await axios.get(url, { timeout: 10000, responseType: 'text', transformResponse: [d => d], headers: { 'User-Agent': 'Mozilla/5.0 TruthLensAI/2.0' } })
  return parseRss(res.data, lang, category).slice(0, limit)
}

async function fetchEventRegistry(lang, category, limit) {
  const key = process.env.ER_API_KEY
  if (!key) return []
  const ed = EDITIONS[lang] || EDITIONS.en
  const kw = (CATEGORY_QUERIES[category] || '').split(' OR ').map(s => s.trim()).filter(Boolean)
  const res = await axios.post('https://eventregistry.org/api/v1/article/getArticles', {
    action: 'getArticles',
    ...(category !== 'all' && kw.length ? { keyword: kw, keywordOper: 'or' } : {}),
    lang: [ed.er],
    articlesPage: 1,
    articlesCount: Math.min(limit, 40),
    articlesSortBy: 'date',
    resultType: 'articles',
    apiKey: key,
  }, { timeout: 12000 })
  if (res.data && res.data.error) throw new Error(String(res.data.error))
  return (res.data?.articles?.results || []).map(a => ({
    id: a.url,
    headline: a.title || '',
    source: a.source?.title || 'News',
    url: a.url,
    publishedAt: a.dateTimePub || a.dateTime || null,
    summary: (a.body || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    image: a.image || null,
    category,
    lang,
    provider: 'event-registry',
  })).filter(a => a.headline && a.url)
}

function normTitle(t) { return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 70) }

/**
 * @returns {Promise<{items:Array, fetchedAt:string, providers:string[], errors:string[], cached:boolean}>}
 */
async function getLiveNews({ lang = 'en', category = 'all', limit = 18 } = {}) {
  if (!EDITIONS[lang]) lang = 'en'
  if (!CATEGORY_QUERIES[category]) category = 'all'
  limit = Math.max(1, Math.min(parseInt(limit, 10) || 18, 40))
  const key = `${lang}|${category}|${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.value, cached: true }

  const errors = []
  const providers = []
  const settled = await Promise.allSettled([
    fetchGoogleNews(lang, category, limit).then(r => { providers.push('google-news'); return r }),
    fetchEventRegistry(lang, category, limit).then(r => { if (r.length) providers.push('event-registry'); return r }),
  ])
  let all = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') all.push(...s.value)
    else errors.push(`${i === 0 ? 'google-news' : 'event-registry'}: ${s.reason && s.reason.message}`)
  })

  // De-duplicate (prefer Event Registry copies: they carry snippets/images), newest first.
  const seen = new Map()
  for (const it of all.sort((a, b) => (a.provider === 'event-registry' ? -1 : 1) - (b.provider === 'event-registry' ? -1 : 1))) {
    const k = normTitle(it.headline)
    if (!seen.has(k)) seen.set(k, it)
  }
  const items = [...seen.values()]
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, limit)

  if (!items.length && errors.length) {
    const hitStale = cache.get(key)
    if (hitStale) return { ...hitStale.value, cached: true, stale: true, errors }
    const e = new Error('Live news providers are unavailable right now.')
    e.errorCode = 'NEWS_UNAVAILABLE'; e.status = 503; e.details = errors.join(' | ')
    throw e
  }

  const value = { items, fetchedAt: new Date().toISOString(), providers, errors, lang, category }
  cache.set(key, { at: Date.now(), value })
  return { ...value, cached: false }
}

module.exports = { getLiveNews, parseRss, _clearCache: () => cache.clear() }
