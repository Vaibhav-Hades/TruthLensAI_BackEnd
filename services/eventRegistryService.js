/**
 * eventRegistryService.js
 * 
 * PHASE 3 V3: Streamlined Precision Retrieval & Evidence Synthesis
 * Optimized for fast article retrieval and clean journalistic evidence ranking.
 */

const { robustFetch } = require('../utils/apiClient');
const logger = require('../utils/pipelineLogger');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

const PREMIUM_SOURCES = new Set([
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'aljazeera.com', 
  'bloomberg.com', 'wsj.com', 'nytimes.com', 'theguardian.com',
  'aninews.in', 'timesofindia.indiatimes.com', 'economictimes.indiatimes.com',
  'thehindu.com', 'indianexpress.com', 'hindustantimes.com', 'indiatoday.in', 
  'ndtv.com', 'news18.com', 'pib.gov.in',
  'factcheck.org', 'politifact.com', 'snopes.com', 'altnews.in', 'boomlive.in'
]);

async function analyzeLiveNarrative(pipelineInput, intelligence) {
  const startTime = Date.now();
  console.log('[retrieval:v3] 🔍 Initiating Streamlined Retrieval...');

  try {
    // NEW: Per-claim search and comparison
    const claims = intelligence.extractedClaims || intelligence.claims || [];
    const claimVerifications = [];
    let allRawArticles = [];

    // Search for articles for each claim
    for (const claim of claims.slice(0, 5)) { // Limit to top 5 claims
      const searchQuery = claim.searchQuery || claim.claim;
      const erQuery = buildClaimQuery(claim, intelligence);
      const rawArticles = await fetchArticlesFromER(erQuery);
      
      if (rawArticles.length > 0) {
        // Compare this claim against found articles
        const verification = await verifyClaimAgainstArticles(claim, rawArticles, intelligence);
        claimVerifications.push(verification);
        allRawArticles.push(...rawArticles);
      } else {
        claimVerifications.push({
          claim: claim.claim,
          verdict: 'Unverified',
          confidence: 0,
          evidence: [],
          reasoning: 'No relevant articles found to verify this claim.'
        });
      }
    }

    // Also do a general search for overall context
    const { searchQuery, erQuery } = buildSimpleQuery(intelligence);
    const generalArticles = await fetchArticlesFromER(erQuery);
    allRawArticles.push(...generalArticles);

    // Deduplicate articles
    const uniqueArticles = deduplicateArticles(allRawArticles);
    
    if (uniqueArticles.length === 0) {
      return getEmptyEvidenceResult('No institutional evidence found for these identifiers.');
    }

    // Process evidence for overall context
    const evidence = await processEvidence(uniqueArticles, intelligence);
    const durationMs = Date.now() - startTime;

    logger.logRetrieval({
      queryUsed: searchQuery,
      articlesFound: uniqueArticles.length,
      claimsVerified: claimVerifications.length,
      durationMs
    });

    return {
      ...evidence,
      claimVerifications, // NEW: Per-claim verification results
      metadata: { 
        searchQueryUsed: searchQuery, 
        processingTimeMs: durationMs,
        claimsProcessed: claimVerifications.length
      }
    };
  } catch (error) {
    logger.emit('ERROR', 'retrieval', 'Retrieval Failure', { error: error.message });
    return getEmptyEvidenceResult('Internal retrieval failure.');
  }
}

/**
 * Build a search query for a specific claim
 */
function buildClaimQuery(claim, intelligence) {
  // Use claim's searchQuery if provided, otherwise build from claim text
  const claimText = claim.claim || '';
  const entities = claim.entities || [];
  
  // Extract key terms from the claim
  const searchTerms = [
    ...entities.slice(0, 2),
    ...(claim.searchQuery ? [claim.searchQuery] : [])
  ].filter(t => t && t.length > 2);

  // If no specific terms, use a simplified version of the claim
  if (searchTerms.length === 0) {
    const words = claimText.split(/\s+/).filter(w => w.length > 4 && !STOPWORDS.has(w.toLowerCase()));
    searchTerms.push(...words.slice(0, 3));
  }

  return {
    action: "getArticles",
    keyword: searchTerms.length > 0 ? searchTerms : [claimText.slice(0, 50)],
    keywordOper: "or",
    lang: ["eng"],
    articlesPage: 1,
    articlesCount: 10,
    articlesSortBy: "rel",
    resultType: "articles",
    apiKey: process.env.ER_API_KEY || '264ad997-d429-4a6d-825b-54e7c57a101b'
  };
}

/**
 * Verify a specific claim against found articles
 */
async function verifyClaimAgainstArticles(claim, articles, intelligence) {
  const groqKey = process.env.GROQ_API_KEY;
  
  // Prepare article context for the claim
  const articleContext = articles.slice(0, 4).map((art, i) => {
    return `[Article ${i+1}: ${art.source}] ${art.title}: ${(art.body || '').slice(0, 400)}`;
  }).join('\n\n');

  const prompt = `
    You are a fact-checker verifying a specific claim against news articles.
    
    CLAIM TO VERIFY: "${claim.claim}"
    CLAIM CONTEXT: ${claim.context || 'No additional context'}
    
    NEWS ARTICLES FOUND:
    ${articleContext}
    
    TASK: Determine if the claim is SUPPORTED, REFUTED, or UNVERIFIED by these articles.
    
    ANALYSIS:
    1. Does any article directly confirm this claim? (SUPPORTED)
    2. Does any article directly contradict this claim? (REFUTED)
    3. Are the articles about the topic but don't address this specific claim? (UNVERIFIED)
    
    RETURN JSON:
    {
      "verdict": "SUPPORTED|REFUTED|UNVERIFIED",
      "confidence": 0-100,
      "evidence": ["Article title or snippet that supports/refutes"],
      "reasoning": "Brief explanation of why this verdict was reached"
    }
  `;

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: { 
        model: GROQ_MODEL, 
        messages: [{ role: 'user', content: prompt }], 
        temperature: 0.1, 
        response_format: { type: "json_object" } 
      },
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'claim-verification' });

    const parsed = JSON.parse(data.choices[0].message.content);
    
    return {
      claim: claim.claim,
      verdict: parsed.verdict || 'UNVERIFIED',
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
      evidence: parsed.evidence || [],
      reasoning: parsed.reasoning || 'Analysis complete.',
      category: claim.category || 'General'
    };
  } catch (e) {
    return {
      claim: claim.claim,
      verdict: 'UNVERIFIED',
      confidence: 0,
      evidence: [],
      reasoning: 'Verification failed due to processing error.',
      category: claim.category || 'General'
    };
  }
}

/**
 * Deduplicate articles by URL
 */
function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(art => {
    const key = art.url || art.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Stopwords for query building
const STOPWORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','it','its','this','that','was','are','be','been','have','has','had','he','she','they','we','you','i','my','his','her','their','our','your','so','as','if','by','from','up','about','into','than','then','when','there','here','what','which','who','how','all','just','also','more','not','no','do','did','does','will','would','could','should','can','may']);

function buildSimpleQuery(intelligence) {
  const primary = intelligence.retrievalSignals?.retrievalQuery;
  const entities = (intelligence.extractedEntities || intelligence.entities || []).slice(0, 3);
  const keywords = (intelligence.extractedKeywords || intelligence.keywords || []).slice(0, 2);
  
  // Prioritize the extraction-driven retrieval query
  const queryTerms = primary 
    ? [primary] 
    : [...new Set([...entities, ...keywords])].filter(t => t.length > 3);
    
  const searchQuery = queryTerms.join(' ');
  const erQuery = {
    action: "getArticles",
    keyword: queryTerms,
    keywordOper: primary ? "and" : "or",
    lang: ["eng"],
    articlesPage: 1,
    articlesCount: 40,
    articlesSortBy: "rel",
    resultType: "articles",
    apiKey: process.env.ER_API_KEY || '264ad997-d429-4a6d-825b-54e7c57a101b'
  };

  return { searchQuery, erQuery };
}

async function fetchArticlesFromER(query) {
  try {
    const data = await robustFetch({
      method: 'post',
      url: 'https://eventregistry.org/api/v1/article/getArticles',
      data: query
    }, { stage: 'event-registry' });

    return (data.articles?.results || []).map(a => ({
      title: a.title,
      url: a.url,
      source: a.source?.title || 'Institutional Source',
      domain: (a.source?.uri || '').toLowerCase(),
      body: (a.body || '').slice(0, 3000),
      publishDate: a.dateTime
    }));
  } catch (e) { return []; }
}

async function processEvidence(articles, intelligence) {
  const groqKey = process.env.GROQ_API_KEY;
  const summary = intelligence.humanizedSummary || intelligence.summary || '';

  // 1. Semantic Ranking & Filtering
  const ranked = articles.map(art => {
    let score = 0;
    const domain = art.domain.replace('www.', '');
    if (PREMIUM_SOURCES.has(domain)) score += 40;
    
    // Semantic Overlap Check
    const title = art.title.toLowerCase();
    const body = art.body.toLowerCase();
    
    // Check entities
    const matchedEntities = (intelligence.entities || []).filter(e => title.includes(e.toLowerCase()) || body.includes(e.toLowerCase()));
    score += (matchedEntities.length * 15);

    // Check keywords
    const matchedKeywords = (intelligence.keywords || []).filter(k => title.includes(k.toLowerCase()));
    score += (matchedKeywords.length * 10);

    // Contextual relevance
    if (summary && title.split(' ').some(word => word.length > 4 && summary.toLowerCase().includes(word))) {
      score += 20;
    }

    return { ...art, relevanceScore: score, matchedEntities, matchedKeywords };
  })
  .filter(art => art.relevanceScore > 30) // Filter out weak matches
  .sort((a, b) => b.relevanceScore - a.relevanceScore)
  .slice(0, 8);

  // 2. High-Fidelity Summarization
  const articleSummaries = await Promise.all(
    ranked.map(async (art) => {
      const summaryResult = await summarizeArticle(art, summary, groqKey);
      return { 
        ...art, 
        aiSummary: summaryResult.text, 
        stance: summaryResult.stance,
        alignmentStatus: summaryResult.alignmentStatus || (summaryResult.stance === 'support' ? 'Aligned' : summaryResult.stance === 'refute' ? 'Contradicting' : 'Neutral')
      };
    })
  );

  const supports = articleSummaries.filter(a => a.stance === 'support');
  const refutes = articleSummaries.filter(a => a.stance === 'refute');
  
  let consensus = 'insufficient_coverage';
  if (refutes.length > 0 && refutes.length >= supports.length) consensus = 'contradicted';
  else if (supports.length >= 2) consensus = 'strongly_supported';
  else if (supports.length >= 1) consensus = 'partially_supported';

  return {
    articleSummaries,
    supportingArticles: supports,
    contradictingArticles: refutes,
    narrativeAlignmentScore: calculateAlignmentScore(articleSummaries),
    trustedConsensus: consensus
  };
}

async function summarizeArticle(article, context, groqKey) {
  if (!groqKey) return { text: article.title, stance: 'neutral' };

  const prompt = `
    Analyze this article against the investigative summary: "${context.slice(0, 600)}"
    Article Title: ${article.title}
    Article Content: ${article.body.slice(0, 1800)}

    TASK:
    1. Summarize how this article relates to the summary narrative in 1-2 concise sentences.
    2. Identify the stance (support|refute|neutral).
    3. State why it matches (e.g. "Directly confirms claim X", "Provides alternative context for Y").

    RETURN JSON ONLY:
    { 
      "text": "The investigative summary...", 
      "stance": "support|refute|neutral",
      "alignmentStatus": "Aligned|Contradicting|Contextual"
    }
  `;

  try {
    const data = await robustFetch({
      method: 'post',
      url: GROQ_API_URL,
      data: { 
        model: GROQ_MODEL, 
        messages: [{ role: 'user', content: prompt }], 
        temperature: 0.1, 
        response_format: { type: "json_object" } 
      },
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' }
    }, { stage: 'article-semantic-alignment' });

    return JSON.parse(data.choices[0].message.content);
  } catch (e) {
    return { text: article.title, stance: 'neutral' };
  }
}

function calculateAlignmentScore(articles) {
  if (!articles.length) return 50;
  const sum = articles.reduce((acc, a) => acc + (a.stance === 'support' ? 100 : a.stance === 'refute' ? 10 : 50), 0);
  return Math.round(sum / articles.length);
}

function getEmptyEvidenceResult(reason) {
  return { articleSummaries: [], narrativeAlignmentScore: 50, trustedConsensus: 'insufficient_coverage' };
}

module.exports = { analyzeLiveNarrative };
