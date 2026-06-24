/**
 * pipelineLogger.js
 *
 * PHASE 8 V2: Structured Observability & Pipeline Instrumentation
 * Captures timing, confidence, retrieval quality, and fallback triggers
 * for every stage of the TruthLens verification pipeline.
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

function timestamp() {
  return new Date().toISOString();
}

function emit(level, stage, message, meta = {}) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;

  const entry = {
    ts: timestamp(),
    level,
    stage,
    message,
    ...meta
  };

  const icon = { DEBUG: '🔍', INFO: '✅', WARN: '⚠️', ERROR: '❌' }[level] || '•';
  const line = `${icon} [${entry.ts}] [${stage.toUpperCase()}] ${message}`;

  if (level === 'ERROR') {
    console.error(line, Object.keys(meta).length ? meta : '');
  } else if (level === 'WARN') {
    console.warn(line, Object.keys(meta).length ? meta : '');
  } else {
    console.log(line, Object.keys(meta).length ? meta : '');
  }

  return entry;
}

// ─── Stage-Specific Loggers ───────────────────────────────────────────────────

function logPipelineStart(inputType, inputPreview) {
  return emit('INFO', 'pipeline', 'Verification pipeline initiated', {
    inputType,
    inputPreview: inputPreview?.slice(0, 80) + '...'
  });
}

function logTranscript({ source, language, confidence, charCount, fallbackUsed, durationMs }) {
  const level = confidence < 70 ? 'WARN' : 'INFO';
  return emit(level, 'transcript', `Transcript extracted via ${source}`, {
    source,
    language: language || 'unknown',
    confidence: `${confidence}%`,
    charCount,
    fallbackUsed: !!fallbackUsed,
    durationMs
  });
}

function logIntelligence({ summaryLen, claimsCount, keywordsCount, entitiesCount, durationMs }) {
  return emit('INFO', 'intelligence', 'Narrative intelligence extracted', {
    summaryLength: summaryLen,
    claimsExtracted: claimsCount,
    keywordsExtracted: keywordsCount,
    entitiesExtracted: entitiesCount,
    durationMs
  });
}

function logRetrieval({ queryUsed, articlesFound, premiumCount, duplicatesDropped, durationMs }) {
  const level = articlesFound === 0 ? 'WARN' : 'INFO';
  return emit(level, 'retrieval', `EventRegistry returned ${articlesFound} articles`, {
    query: queryUsed?.slice(0, 80),
    articlesFound,
    premiumSources: premiumCount,
    duplicatesDropped,
    durationMs,
    coverageQuality: articlesFound >= 5 ? 'Strong' : articlesFound >= 2 ? 'Moderate' : 'Weak'
  });
}

function logSemantic({ narrativeAlignment, contradictionLevel, consensusState, framingAccuracy, durationMs }) {
  const level = contradictionLevel === 'high' ? 'WARN' : 'INFO';
  return emit(level, 'semantic', 'Semantic verification complete', {
    narrativeAlignment: `${narrativeAlignment}%`,
    contradictionLevel,
    consensusState,
    framingAccuracy,
    durationMs
  });
}

function logCredibility({ score, verdict, confidence, reasoning_length }) {
  const level = score < 30 ? 'WARN' : 'INFO';
  return emit(level, 'credibility', `Verdict: ${verdict} | Score: ${score}/100 | Confidence: ${confidence}%`, {
    score,
    verdict,
    confidence,
    reasoningLength: reasoning_length
  });
}

function logFallback(stage, reason, fallbackType) {
  return emit('WARN', stage, `Fallback triggered: ${fallbackType}`, {
    reason: reason?.slice(0, 120),
    fallbackType
  });
}

function logApiFailure(stage, attempt, error) {
  return emit('ERROR', stage, `API failure on attempt ${attempt}`, {
    errorCode: error?.response?.status || error?.code,
    errorMessage: error?.message?.slice(0, 100)
  });
}

function logPipelineComplete({ totalMs, verdict, score, stagesCompleted, stagesFailed }) {
  const level = stagesFailed > 0 ? 'WARN' : 'INFO';
  return emit(level, 'pipeline', `Pipeline complete in ${totalMs}ms`, {
    totalDurationMs: totalMs,
    verdict,
    credibilityScore: score,
    stagesCompleted,
    stagesFailed
  });
}

// ─── Timing Helpers ───────────────────────────────────────────────────────────

function createTimer() {
  const start = Date.now();
  return {
    elapsed: () => Date.now() - start
  };
}

module.exports = {
  logPipelineStart,
  logTranscript,
  logIntelligence,
  logRetrieval,
  logSemantic,
  logCredibility,
  logFallback,
  logApiFailure,
  logPipelineComplete,
  createTimer,
  emit
};
