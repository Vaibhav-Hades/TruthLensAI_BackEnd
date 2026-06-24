// newsApiService.js
// Fetches live news from NewsAPI.org using extracted keywords.
// Returns articles in the same shape as eventRegistryService._fetchWithKeywords
// so they can be merged seamlessly into the narrative pipeline.
//
// Never throws — always returns [] on any failure.

const axios = require('axios')

const NEWS_API_BASE = 'https://newsapi.org/v2/everything'

// Trusted sources to prioritise (NewsAPI source IDs / name fragments)
const PRIORITY_SOURCES = [
  'reuters', 'bbc-news', 'bbc', 'associated-press', 'ap', 'the-times-of-india',
  'economic-times', 'ani', 'the-hindu', 'ndtv', 'hindustan-times',
  'al-jazeera-english', 'the-washington-post', 'the-guardian-uk',
  'the-new-york-times', 'bloomberg',
]

/**
 * Fetch up to 10 articles from NewsAPI for the given keywords.
 * @param {string[]} keywords
 * @returns {Promise<Array>} articles shaped like EventRegistry results
 */
async function fetchFromNewsApi(keywords) {
  const key = process.env.NEWS_API_KEY
  if (!key || key === 'your_news_api_key_here') {
    console.log('[newsApi] NEWS_API_KEY not set — skipping')
    return []
  }
  if (!keywords || !keywords.length) return []

  // Build query: quoted phrases for multi-word keywords, plain for single words
  const query = keywords
    .slice(0, 5)
    .map(kw => (kw.includes(' ') ? `"${kw}"` : kw))
    .join(' OR ')

  try {
    console.log('[newsApi] Querying:', query)
    const res = await axios.get(NEWS_API_BASE, {
      params: {
        q:        query,
        language: 'en',
        sortBy:   'publishedAt',
        pageSize: 10,
      },
      headers: { 'X-Api-Key': key },
      timeout: 10000,
    })

    const raw = res.data?.articles || []
    console.log(`[newsApi] Raw results: ${raw.length}`)

    // Sort: priority sources first, then by date
    const sorted = raw.slice().sort((a, b) => {
      const aP = isPriority(a.source?.name || '')
      const bP = isPriority(b.source?.name || '')
      if (aP && !bP) return -1
      if (!aP && bP) return 1
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
    })

    return sorted
      .filter(a => a.title && a.url && !a.title.includes('[Removed]'))
      .slice(0, 10)
      .map(a => ({
        title:       (a.title || '').trim(),
        url:         (a.url  || '').trim(),
        source:      a.source?.name || 'NewsAPI',
        body:        (a.content || a.description || '').replace(/\[\+\d+ chars\]$/, '').trim().slice(0, 1200),
        image:       a.urlToImage || null,
        sentiment:   null,
        publishedAt: a.publishedAt || null,
        _via:        'newsapi',   // internal tag so UI can show correct label
      }))

  } catch (err) {
    console.warn('[newsApi] Fetch failed:', err.message)
    if (err.response) {
      console.warn('[newsApi] HTTP status:', err.response.status)
      console.warn('[newsApi] Body:', JSON.stringify(err.response.data || {}).slice(0, 300))
    }
    return []
  }
}

function isPriority(sourceName) {
  const lower = sourceName.toLowerCase()
  return PRIORITY_SOURCES.some(p => lower.includes(p.replace(/-/g, ' ')) || lower.includes(p))
}

module.exports = { fetchFromNewsApi }
