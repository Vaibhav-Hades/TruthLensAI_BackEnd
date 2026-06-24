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

async function runPhase1Pipeline(input) {
  const startTime = Date.now();
  console.log('[pipeline:v2] 🚀 Initiating Intelligence Pipeline...');

  const detection = detectInputType(input);

  let rawTranscript = '';
  let transcriptMeta = {};

  try {
    if (detection.type === 'video') {
      const result = await fetchTranscriptWithFallback(detection.normalizedInput);
      rawTranscript = result.transcript;
      transcriptMeta = {
        transcriptSource: result.transcriptSource,
        languageDetected: result.languageDetected,
        transcriptConfidence: result.transcriptConfidence,
        fallbackUsed: result.fallbackUsed,
        audioQuality: result.audioQuality || 'medium'
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
      transcriptMeta = {
        transcriptSource: 'manual_input',
        languageDetected: 'auto',
        transcriptConfidence: 100,
        fallbackUsed: false
      };
    }

    if (!rawTranscript || rawTranscript.trim().length < 20) {
      throw new Error('Extracted content is too short or empty.');
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
      totalChunks: chunkingResult.totalChunks,
      estimatedTokens: chunkingResult.estimatedTokens,
      processingTimeMs: processingTime,
      processedAt: new Date().toISOString(),
      version: '2.0.0-Stable'
    }
  };
}

async function fetchArticleText(url) {
  try {
    const response = await axios.get(url, {
      timeout: 20000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      }
    });

    let html = response.data || '';
    
    // Clean HTML
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

    // Extract core content (prioritize semantic tags)
    let body = '';
    const selectors = [/<article[^>]*>([\s\S]*?)<\/article>/i, /<main[^>]*>([\s\S]*?)<\/main>/i, /<div id="content"[^>]*>([\s\S]*?)<\/div>/i];
    
    for (const regex of selectors) {
      const match = html.match(regex);
      if (match) {
        body = match[1];
        break;
      }
    }

    if (!body) {
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let m;
      const paragraphs = [];
      while ((m = pRegex.exec(html)) !== null) {
        const t = m[1].replace(/<[^>]+>/g, ' ').trim();
        if (t.length > 50) paragraphs.push(t);
      }
      body = paragraphs.join('\n');
    }

    const cleaned = body
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (cleaned.length < 100) {
      throw new Error('Article too short');
    }

    return cleaned.slice(0, 15000);
  } catch (err) {
    const error = new Error('Article retrieval failed. The site may be protected or restricted.');
    error.errorCode = 'ARTICLE_FETCH_FAILED';
    throw error;
  }
}

module.exports = { runPhase1Pipeline };
