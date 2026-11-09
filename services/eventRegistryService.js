/**
 * eventRegistryService.js
 *
 * PHASE 3: Live evidence retrieval from Event Registry + per-claim stance checking.
 *
 * Required env: ER_API_KEY (Event Registry), GROQ_API_KEY (stance checking).
 * Without ER_API_KEY retrieval is skipped and reported via `retrievalStatus`
 * (the pipeline then returns INCONCLUSIVE instead of guessing).
 *
 * A claim is only marked SUPPORTED/REFUTED when the model cites at least one of the
 * supplied articles. Anything else is UNVERIFIED. Topic similarity is never treated as support.
 */

const { robustFetch } = require('../utils/apiClient');
const { searchNews, enrichBodies } = require('./webSearchService');
const logger = require('../utils/pipelineLogger');
const { GROQ_API_URL, GROQ_MODEL } = require('../config/llm');

const ER_URL = 'https://eventregistry.org/api/v1/article/getArticles';

const PREMIUM_SOURCES = new Set([
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'aljazeera.com',
  'bloomberg.com', 'wsj.com', 'nytimes.com', 'theguardian.com',
  'aninews.in', 'timesofindia.indiatimes.com', 'economictimes.indiatimes.com',
  'thehindu.com', 'indianexpress.com', 'hindustantimes.com', 'indiatoday.in',
  'ndtv.com', 'news18.com', 'pib.gov.in',
  'factcheck.org', 'politifact.com', 'snopes.com', 'altnews.in', 'boomlive.in'
]);

const STOPWORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','it','its','this','that','was','are','be','been','have','has','had','he','she','they','we','you','i','my','his','her','their','our','your','so','as','if','by','from','up','about','into','than','then','when','there','here','what','which','who','how','all','just','also','more','not','no','do','did','does','will','would','could','should','can','may']);

function getErKey() { return process.env.ER_API_KEY || '' }

function isPremium(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  return PREMIUM_SOURCES.has(d) || [...PREMIUM_SOURCES].some(p => d.endsWith('.' + p));
}

async function analyzeLiveNarrative(pipelineInput, intelligence) {
  const startTime = Date.now();

  try {
    const claims = claimsOf(intelligence);
    const erState = { errors: [], calls: 0 };

    // Claims are checked in parallel (sequential calls blew the request time budget).
    const perClaim = await Promise.all(claims.map(async (claim) => {
      const articles = await searchForClaim(claim, intelligence, erState);
      if (!articles.length) {
        return { articles: [], verification: unverified(claim, 'No relevant news articles were found for this claim.') };
      }
      const enriched = await enrichBodies(articles, 3);   // read real article text where possible
      const verification = await verifyClaimAgainstArticles(claim, enriched);
      return { articles: enriched, verification };
    }));

    const claimVerifications = perClaim.map(p => p.verification);
    let allRawArticles = perClaim.flatMap(p => p.articles);

    // General topical search for context panels.
    const generalQuery = buildSimpleQuery(intelligence);
    if (generalQuery.keyword.length) {
      allRawArticles.push(...await fetchArticles(generalQuery, erState));
    }

    const uniqueArticles = deduplicateArticles(allRawArticles);
    const retrievalStatus = erState.errors.length && erState.errors.length >= erState.calls
      ? `search_error:${erState.errors[0]}`
      : 'ok';

    if (uniqueArticles.length === 0) {
      return { ...getEmptyEvidenceResult(retrievalStatus === 'ok' ? 'no_articles' : retrievalStatus, claims), claimVerifications };
    }

    const evidence = await processEvidence(uniqueArticles, intelligence, claimVerifications);
    const durationMs = Date.now() - startTime;

    logger.logRetrieval({
      queryUsed: generalQuery.keyword.join(' '),
      articlesFound: uniqueArticles.length,
      claimsVerified: claimVerifications.length,
      durationMs
    });

    return {
      ...evidence,
      claimVerifications,
      retrievalStatus,
      metadata: {
        searchQueryUsed: generalQuery.keyword.join(' '),
        processingTimeMs: durationMs,
        claimsProcessed: claimVerifications.length,
        provider: erState.provider || null,
        erCalls: erState.calls,
        erErrors: erState.errors.length
      }
    };
  } catch (error) {
    logger.emit('ERROR', 'retrieval', 'Retrieval Failure', { error: error.message });
    return getEmptyEvidenceResult(`retrieval_failure:${error.message}`, claimsOf(intelligence));
  }
}

function unverified(claim, reasoning) {
  return {
    claim: claim.claim,
    verdict: 'UNVERIFIED',
    confidence: 0,
    evidence: [],
    reasoning,
    category: claim.category || 'General'
  };
}

/** Search with a strict (AND) query first; fall back to a looser (OR) query if it finds nothing. */
async function searchForClaim(claim, intelligence, erState) {
  const terms = claimSearchTerms(claim);
  if (!terms.length) return [];
  let articles = await fetchArticles(erQuery(terms, 'and', 10), erState);
  if (articles.length < 2 && terms.length > 1) {
    articles = articles.concat(await fetchArticles(erQuery(terms, 'or', 10), erState));
  }
  // Third attempt: the claim's own wording as a plain phrase query (works best for keyless web search).
  if (articles.length < 3) {
    const phrase = String(claim.searchQuery || claim.claim || '').split(/\s+/).slice(0, 12).join(' ');
    if (phrase.length > 8) articles = articles.concat(await fetchArticles(erQuery([phrase.replace(/"/g, '')], 'and', 10), erState));
  }
  return deduplicateArticles(articles);
}

function claimSearchTerms(claim) {
  const fromEntities = (claim.entities || []).filter(e => typeof e === 'string' && e.length > 2).slice(0, 2);
  const text = claim.searchQuery || claim.claim || '';
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3 && !STOPWORDS.has(w.toLowerCase()));
  return [...new Set([...fromEntities, ...words])].slice(0, 4);
}

function erQuery(keywords, oper, count) {
  return {
    action: 'getArticles',
    keyword: keywords,
    keywordOper: oper,
    lang: ['eng'],
    articlesPage: 1,
    articlesCount: count,
    articlesSortBy: 'rel',
    resultType: 'articles',
    apiKey: getErKey()
  };
}

function buildSimpleQuery(intelligence) {
  const primary = intelligence.retrievalSignals?.retrievalQuery;
  const entities = (intelligence.extractedEntities || intelligence.entities || []).slice(0, 3);
  const keywords = (intelligence.extractedKeywords || intelligence.keywords || []).slice(0, 2);
  const terms = primary ? [primary] : [...new Set([...entities, ...keywords])].filter(t => typeof t === 'string' && t.length > 3);
  return erQuery(terms, primary ? 'and' : 'or', 30);
}

/**
 * Compares one claim with retrieved articles. The model must cite article numbers;
 * a SUPPORTED/REFUTED verdict without citations is downgraded to UNVERIFIED.
 */
async function verifyClaimAgainstArticles(claim, articles) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return unverified(claim, 'Stance checking is unavailable (GROQ_API_KEY not set).');

  const used = articles.slice(0, 5);
  const articleContext = used.map((art, i) =>
    `[Article ${i + 1}: ${art.source}] ${art.title}: ${(art.body || '').slice(0, 500)}`
  ).join('\n\n');

  const prompt = `
You are a careful fact-checker. Decide whether the NEWS ARTICLES below confirm or contradict the CLAIM.

CLAIM: "${claim.claim}"
CLAIM CONTEXT: ${claim.context || 'none'}

NEWS ARTICLES:
${articleContext}

RULES
- SUPPORTED: at least one article states the same fact (same people, event, numbers).
- REFUTED: at least one article states something that directly conflicts with the claim.
- UNVERIFIED: the articles are only on the same topic, or do not address this specific claim.
- Similar topic or shared keywords is NOT support. When in doubt choose UNVERIFIED.
- Cite the article numbers you relied on in "articleNumbers".

Return JSON only:
{"verdict":"SUPPORTED|REFUTED|UNVERIFIED","confidence":0-100,"articleNumbers":[1],"evidence":["short quote or paraphrase"],"reasoning":"one or two sentences"}`;

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      },
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'claim-verification' });

    const parsed = JSON.parse(data.choices[0].message.content);
    let verdict = String(parsed.verdict || 'UNVERIFIED').toUpperCase();
    if (!['SUPPORTED', 'REFUTED', 'UNVERIFIED'].includes(verdict)) verdict = 'UNVERIFIED';
    const cited = (Array.isArray(parsed.articleNumbers) ? parsed.articleNumbers : [])
      .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= used.length);

    if (verdict !== 'UNVERIFIED' && cited.length === 0) {
      return unverified(claim, 'The model gave a verdict without citing any article, so it was discarded.');
    }

    return {
      claim: claim.claim,
      verdict,
      confidence: verdict === 'UNVERIFIED' ? 0 : Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 3).map(String) : [],
      citedArticles: cited.map(n => ({ title: used[n - 1].title, url: used[n - 1].url, source: used[n - 1].source })),
      reasoning: String(parsed.reasoning || 'Analysis complete.'),
      category: claim.category || 'General'
    };
  } catch (e) {
    return unverified(claim, 'Verification failed due to a processing error.');
  }
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(art => {
    const key = art.url || art.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Retrieval with automatic fallback: Event Registry (if ER_API_KEY is set) -> keyless web news search.
 * A failure is only recorded when no provider could answer.
 */
async function fetchArticles(query, erState) {
  const local = { errors: [], calls: 0 };
  if (getErKey()) {
    const r = await fetchArticlesFromER(query, local);
    if (r.length) { erState.calls++; erState.provider = 'event-registry'; return r; }
  }
  erState.calls++;
  try {
    const lang = (query.lang && query.lang[0]) || 'eng';
    const r = await searchNews(query.keyword, query.keywordOper, lang, Math.min(query.articlesCount || 10, 15));
    if (r.length) erState.provider = erState.provider || 'web-search';
    return r;
  } catch (e) {
    erState.errors.push(`web_search:${e.response?.status ? 'http_' + e.response.status : e.message}`.slice(0, 120));
    return [];
  }
}

/** Calls Event Registry. Never throws; records failures in erState. */
async function fetchArticlesFromER(query, erState = { errors: [], calls: 0 }) {
  erState.calls++;
  try {
    const data = await robustFetch({ method: 'post', url: ER_URL, data: query }, { stage: 'event-registry', retries: 2 });
    // Event Registry reports many failures (bad key, quota) as HTTP 200 with an `error` field.
    if (data && data.error) {
      erState.errors.push(String(data.error).slice(0, 120));
      console.warn('[event-registry] API error:', data.error);
      return [];
    }
    return (data?.articles?.results || []).map(a => ({
      title: a.title || '',
      url: a.url,
      source: a.source?.title || 'Institutional Source',
      domain: (a.source?.uri || '').toLowerCase(),
      body: (a.body || '').slice(0, 3000),
      image: a.image || null,
      publishDate: a.dateTime || a.date
    }));
  } catch (e) {
    erState.errors.push(e.response?.status ? `http_${e.response.status}` : e.message);
    return [];
  }
}

async function processEvidence(articles, intelligence, claimVerifications = []) {
  const groqKey = process.env.GROQ_API_KEY;
  const summary = intelligence.humanizedSummary || intelligence.summary || '';
  const entities = intelligence.extractedEntities || intelligence.entities || [];
  const keywords = intelligence.extractedKeywords || intelligence.keywords || [];

  // Rank by real topical overlap; a trusted domain is a bonus, never enough on its own.
  const ranked = articles.map(art => {
    const title = (art.title || '').toLowerCase();
    const body = (art.body || '').toLowerCase();
    const matchedEntities = entities.filter(e => typeof e === 'string' && (title.includes(e.toLowerCase()) || body.includes(e.toLowerCase())));
    const matchedKeywords = keywords.filter(k => typeof k === 'string' && title.includes(k.toLowerCase()));
    let score = matchedEntities.length * 15 + matchedKeywords.length * 10;
    if (summary && title.split(' ').some(w => w.length > 4 && summary.toLowerCase().includes(w))) score += 20;
    const premium = isPremium(art.domain);
    if (score > 0 && premium) score += 40;
    return { ...art, relevanceScore: score, matchedEntities, matchedKeywords, trusted: premium };
  })
    .filter(a => a.relevanceScore > 30)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 8);

  const articleSummaries = await Promise.all(ranked.map(async (art) => {
    const s = await summarizeArticle(art, summary, groqKey, claimVerifications);
    return {
      ...art,
      aiSummary: s.text,
      stance: s.stance,
      alignmentStatus: s.alignmentStatus || (s.stance === 'support' ? 'Aligned' : s.stance === 'refute' ? 'Contradicting' : 'Neutral')
    };
  }));

  const supports = articleSummaries.filter(a => a.stance === 'support');
  const refutes = articleSummaries.filter(a => a.stance === 'refute');
  const trustedCoverage = articleSummaries.filter(a => a.trusted).length;

  let consensus = 'insufficient_coverage';
  if (refutes.length > 0 && refutes.length >= supports.length) consensus = 'contradicted';
  else if (supports.length >= 2) consensus = 'strongly_supported';
  else if (supports.length >= 1) consensus = 'partially_supported';

  return {
    articleSummaries,
    supportingArticles: supports,
    contradictingArticles: refutes,
    narrativeAlignmentScore: calculateAlignmentScore(articleSummaries),
    trustedConsensus: consensus,
    sourceMetadata: { trustedCoverage, totalArticles: articleSummaries.length }
  };
}

async function summarizeArticle(article, context, groqKey) {
  if (!groqKey) return { text: article.title, stance: 'neutral' };

  const prompt = `
Analyze this article against the investigative summary: "${context.slice(0, 600)}"
Article Title: ${article.title}
Article Content: ${(article.body || '').slice(0, 1800)}

TASK
1. Summarize in 1-2 sentences how the article relates to the summary.
2. stance: "support" only if the article confirms a specific fact in the summary about the same event. "refute" only if it explicitly states the opposite of a specific fact in the summary about the SAME event and time. Articles about a different date, a later or earlier event, or merely the same topic are "neutral".

RETURN JSON ONLY:
{"text":"...","stance":"support|refute|neutral","alignmentStatus":"Aligned|Contradicting|Contextual"}`;

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 300, response_format: { type: 'json_object' } },
      headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'article-semantic-alignment', retries: 1 });
    const parsed = JSON.parse(data.choices[0].message.content);
    if (!['support', 'refute', 'neutral'].includes(parsed.stance)) parsed.stance = 'neutral';
    return parsed;
  } catch (e) {
    return { text: article.title, stance: 'neutral' };
  }
}

function calculateAlignmentScore(articles) {
  if (!articles.length) return 50;
  const sum = articles.reduce((acc, a) => acc + (a.stance === 'support' ? 100 : a.stance === 'refute' ? 10 : 50), 0);
  return Math.round(sum / articles.length);
}

function claimsOf(intelligence) {
  return (intelligence.extractedClaims || intelligence.claims || []).filter(c => c && c.claim).slice(0, 5);
}

function getEmptyEvidenceResult(retrievalStatus, claims = []) {
  const why = retrievalStatus === 'er_key_missing'
    ? 'Live news retrieval is not configured (ER_API_KEY missing).'
    : retrievalStatus === 'no_articles'
      ? 'No relevant news articles were found for this claim.'
      : `Live news retrieval failed (${retrievalStatus}).`;
  return {
    articleSummaries: [],
    supportingArticles: [],
    contradictingArticles: [],
    claimVerifications: claims.map(c => unverified(c, why)),
    narrativeAlignmentScore: 50,
    trustedConsensus: 'insufficient_coverage',
    sourceMetadata: { trustedCoverage: 0, totalArticles: 0 },
    retrievalStatus
  };
}

module.exports = { analyzeLiveNarrative, fetchArticlesFromER, fetchArticles, verifyClaimAgainstArticles, claimSearchTerms };
