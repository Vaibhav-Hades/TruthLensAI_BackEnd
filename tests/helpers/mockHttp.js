/**
 * Replaces axios' network adapter with a scripted router so tests never hit Groq / Event Registry /
 * websites. Scenario knobs live on the exported `scenario` object.
 */
const axios = require('axios')

const scenario = {
  groqOnline: true,
  claims: [{ claim: 'The Reserve Bank of India raised the repo rate by 25 basis points in 2023.', entities: ['Reserve Bank of India'], searchQuery: 'Reserve Bank of India repo rate', category: 'Economic' }],
  claimVerdict: 'SUPPORTED',        // SUPPORTED | REFUTED | UNVERIFIED
  claimCitesArticle: true,
  articleStance: 'support',         // support | refute | neutral
  erResults: [
    { title: 'RBI raises repo rate by 25 bps', url: 'https://www.reuters.com/a1', source: { title: 'Reuters', uri: 'reuters.com' }, body: 'The Reserve Bank of India raised the repo rate by 25 basis points. Reserve Bank of India governor said inflation remains high.', dateTime: '2023-02-08T00:00:00Z' },
    { title: 'Reserve Bank of India repo rate decision explained', url: 'https://www.thehindu.com/a2', source: { title: 'The Hindu', uri: 'thehindu.com' }, body: 'Reserve Bank of India repo rate was lifted again. The repo rate hike was 25 basis points.', dateTime: '2023-02-08T00:00:00Z' },
  ],
  erError: null,                    // string => ER answers HTTP 200 {error}
  erHttpStatus: 200,
  pages: {},                        // url -> { status, contentType, body }
  rssError: false,
  webError: false,
  bing: '<rss><channel><item><title>RBI hikes repo rate by 25 bps</title><link>http://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3a%2f%2fwww.thehindu.com%2fa1&amp;c=1</link><description>The Reserve Bank of India raised the repo rate by 25 basis points on Wednesday.</description><pubDate>Wed, 08 Feb 2023 05:00:00 GMT</pubDate><News:Source>The Hindu</News:Source></item></channel></rss>',
  rss: '<rss><channel><item><title>Rates rise again - Reuters</title><link>https://news.example.com/1</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item><item><title>Older story - The Hindu</title><link>https://news.example.com/2</link><pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate><source url="https://thehindu.com">The Hindu</source></item><item><title>Rates rise again - Reuters</title><link>https://news.example.com/3</link><pubDate>Mon, 09 Nov 2026 09:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>',
  calls: [],
}

function reset() {
  scenario.groqOnline = true
  scenario.claims = [{ claim: 'The Reserve Bank of India raised the repo rate by 25 basis points in 2023.', entities: ['Reserve Bank of India'], searchQuery: 'Reserve Bank of India repo rate', category: 'Economic' }]
  scenario.claimVerdict = 'SUPPORTED'
  scenario.claimCitesArticle = true
  scenario.articleStance = 'support'
  scenario.erError = null
  scenario.erHttpStatus = 200
  scenario.pages = {}
  scenario.rssError = false
  scenario.webError = false
  scenario.calls = []
}

function httpError(config, status, data) {
  const err = new Error(`Request failed with status code ${status}`)
  err.config = config
  err.response = { status, data, headers: {}, config }
  return err
}

function ok(config, data, headers = { 'content-type': 'application/json' }) {
  return { data, status: 200, statusText: 'OK', headers, config }
}

async function adapter(config) {
  const url = String(config.url)
  const body = typeof config.data === 'string' ? safeParse(config.data) : config.data
  scenario.calls.push({ url, body })

  if (url.includes('eventregistry.org')) {
    if (scenario.erHttpStatus !== 200) throw httpError(config, scenario.erHttpStatus, {})
    if (scenario.erError) return ok(config, { error: scenario.erError })
    return ok(config, { articles: { results: scenario.erResults } })
  }

  if (url.includes('api.groq.com')) {
    if (!scenario.groqOnline) throw httpError(config, 400, { error: 'offline' })
    const prompt = (body?.messages || []).map(m => m.content).join(' ')
    const reply = (obj) => ok(config, { choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] })

    if (prompt.includes('CLAIM TO VERIFY') || prompt.includes('careful fact-checker')) {
      return reply({
        verdict: scenario.claimVerdict, confidence: 85,
        articleNumbers: scenario.claimCitesArticle ? [1] : [],
        evidence: ['Article states the same fact'], reasoning: 'Mock reasoning.',
      })
    }
    if (prompt.includes('Analyze this article against')) {
      return reply({ text: 'Mock article summary.', stance: scenario.articleStance, alignmentStatus: 'Aligned' })
    }
    if (prompt.includes('Extract specific STATEMENTS')) {
      return reply({ extractedClaims: scenario.claims.map(c => ({ ...c, context: 'ctx', confidence: 90 })), videoSummary: 'Mock summary of the content.', verdict_label: 'Questionable', meaning: 'Mock meaning.' })
    }
    if (prompt.includes('Write a short explanation')) {
      return reply('Mock editor explanation.')
    }
    if (prompt.includes('Translate every value')) {
      const m = prompt.match(/(\{"0":[\s\S]*\})\s*$/)
      const input = m ? JSON.parse(m[1]) : {}
      const out = {}
      Object.keys(input).forEach(k => { out[k] = 'अनुवादित ' + input[k] })
      return reply(out)
    }
    if (prompt.includes('INVESTIGATION DATA')) {
      return reply('Mock chat answer.')
    }
    // Everything else (summary engine, keyword engine, ...): 400 => no retry => deterministic NLP fallback.
    throw httpError(config, 400, { error: 'not mocked' })
  }

  if (url.includes('bing.com/news/search')) {
    if (scenario.webError) throw httpError(config, 503, '')
    return ok(config, scenario.bing, { 'content-type': 'application/rss+xml' })
  }

  if (url.includes('news.google.com/rss')) {
    if (scenario.rssError) throw httpError(config, 503, '')
    return ok(config, scenario.rss, { 'content-type': 'application/rss+xml' })
  }

  if (scenario.pages[url]) {
    const p = scenario.pages[url]
    if (p.status && p.status !== 200) throw httpError(config, p.status, '')
    return ok(config, p.body, { 'content-type': p.contentType || 'text/html' })
  }

  throw httpError(config, 404, 'unmocked url ' + url)
}

function safeParse(s) { try { return JSON.parse(s) } catch (_) { return null } }

function install() { axios.defaults.adapter = adapter }

module.exports = { install, scenario, reset }
