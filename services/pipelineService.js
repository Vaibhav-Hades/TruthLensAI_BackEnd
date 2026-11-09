/**
 * pipelineService.js
 * 
 * PHASE 1 V2 REFINED: High-Reliability Transcript Pipeline
 */

const { detectInputType } = require('./inputDetector');
const { fetchTranscriptWithFallback } = require('./transcriptService');
const { cleanTranscript } = require('./transcriptCleaningService');
const { chunkContent } = require('./chunkingService');
const axios = require('axios');
const { assertPublicUrl, appError } = require('../utils/inputValidation');

const MAX_ANALYSIS_CHARS = parseInt(process.env.MAX_ANALYSIS_CHARS || '20000', 10);

async function runPhase1Pipeline(input) {
  const startTime = Date.now();
  console.log('[pipeline:v2] 🚀 Initiating Intelligence Pipeline...');

  const detection = detectInputType(input);

  let rawTranscript = '';
  let transcriptMeta = {};
  let truncated = false;

  try {
    if (detection.type === 'video') {
      if (!detection.videoId) {
        throw appError('Only YouTube video links are supported for video analysis. For other platforms, paste the transcript or caption as text.', 'UNSUPPORTED_CONTENT', 422);
      }
      const result = await fetchTranscriptWithFallback(detection.normalizedInput);
      rawTranscript = result.transcript;
      transcriptMeta = {
        transcriptSource: result.transcriptSource,
        languageDetected: result.languageDetected,
        transcriptConfidence: result.transcriptConfidence,
        fallbackUsed: result.fallbackUsed,
        audioQuality: result.audioQuality || 'medium',
        metadataOnly: !!result.metadataOnly
      };
    } 
    else if (detection.type === 'article') {
      rawTranscript = await fetchArticleText(detection.normalizedInput);
      transcriptMeta = {
        transcriptSource: 'article_scraper',
        languageDetected: 'auto',
        transcriptConfidence: 95,
        fallbackUsed: false
      };
    } 
    else {
      rawTranscript = detection.normalizedInput;
      if (rawTranscript.length > MAX_ANALYSIS_CHARS) {
        rawTranscript = rawTranscript.slice(0, MAX_ANALYSIS_CHARS);
        truncated = true;
      }
      transcriptMeta = {
        transcriptSource: 'manual_input',
        languageDetected: 'auto',
        transcriptConfidence: 100,
        fallbackUsed: false
      };
    }

    if (!rawTranscript || rawTranscript.trim().length < 20) {
      throw appError('The extracted content is too short or empty to analyze.', 'CONTENT_TOO_SHORT', 422);
    }
  } catch (err) {
    if (!err.errorCode) err.errorCode = 'CONTENT_EXTRACTION_FAILED';
    throw err;
  }

  const cleanedTranscript = cleanTranscript(rawTranscript);
  const chunkingResult = chunkContent(cleanedTranscript);
  const processingTime = Date.now() - startTime;

  return {
    sourceType: detection.type,
    transcript: rawTranscript,
    cleanedTranscript: cleanedTranscript,
    chunks: chunkingResult.chunks,
    metadata: {
      ...detection,
      ...transcriptMeta,
      truncated,
      totalChunks: chunkingResult.totalChunks,
      estimatedTokens: chunkingResult.estimatedTokens,
      processingTimeMs: processingTime,
      processedAt: new Date().toISOString(),
      version: '2.0.0-Stable'
    }
  };
}

async function fetchArticleText(url) {
  await assertPublicUrl(url);
  let response;
  try {
    response = await axios.get(url, {
      timeout: 20000,
      maxRedirects: 3,
      maxContentLength: 5 * 1024 * 1024,
      responseType: 'text',
      transformResponse: [d => d],
      beforeRedirect: (opts) => {
        // Block redirects into localhost / private literals (full DNS re-check is done on the first hop).
        if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i.test(opts.hostname || '')) {
          throw new Error('Redirect to a private address blocked');
        }
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
  } catch (err) {
    throw appError('Article retrieval failed. The site may be unreachable, protected, or restricted.', 'ARTICLE_FETCH_FAILED', 422);
  }

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (contentType && !/(text\/html|application\/xhtml|text\/plain)/.test(contentType)) {
    throw appError('That link does not point to a readable web page (PDF, image or file links are not supported).', 'UNSUPPORTED_CONTENT', 422);
  }

  let html = String(response.data || '');
  if (/text\/plain/.test(contentType)) {
    const plain = html.replace(/\s{2,}/g, ' ').trim();
    if (plain.length < 100) throw appError('The page has too little readable text to analyze.', 'CONTENT_TOO_SHORT', 422);
    return plain.slice(0, MAX_ANALYSIS_CHARS);
  }

  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|nav|footer|header|iframe|aside|form|noscript|svg)[\s\S]*?<\/>/gi, '');

  let body = '';
  const selectors = [/<article[^>]*>([\s\S]*?)<\/article>/i, /<main[^>]*>([\s\S]*?)<\/main>/i];
  for (const regex of selectors) {
    const match = html.match(regex);
    if (match && match[1].replace(/<[^>]+>/g, '').trim().length > 200) { body = match[1]; break; }
  }
  if (!body) {
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    const paragraphs = [];
    while ((m = pRegex.exec(html)) !== null) {
      const t = m[1].replace(/<[^>]+>/g, ' ').trim();
      if (t.length > 50) paragraphs.push(t);
    }
    body = paragraphs.join(' ');
  }

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const decode = (t) => t
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const cleaned = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s{2,}/g, ' ').trim();

  if (cleaned.length < 100) {
    throw appError('Could not find readable article text on that page. It may be paywalled or rendered by JavaScript.', 'CONTENT_TOO_SHORT', 422);
  }
  const head = title.trim() ? decode(title.trim()) + '. ' : '';
  return (head + cleaned).slice(0, MAX_ANALYSIS_CHARS);
}

module.exports = { runPhase1Pipeline };
