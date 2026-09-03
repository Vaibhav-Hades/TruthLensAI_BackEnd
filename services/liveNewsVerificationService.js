/**
 * liveNewsVerificationService.js
 * 
 * PHASE 3 V2 REFINED: Trusted News Consensus & Source Traceability
 * Synthesizes evidence from multiple retrieval vectors into a unified consensus.
 */

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

// ── SYNCED TRUSTED SOURCE REGISTRY ───────────────────────────────────────────
const TRUSTED_DOMAINS = {
  'reuters.com':          { name: 'Reuters',          credibility: 0.95, tier: 'premium' },
  'apnews.com':           { name: 'AP News',           credibility: 0.95, tier: 'premium' },
  'bbc.com':              { name: 'BBC',               credibility: 0.92, tier: 'premium' },
  'bbc.co.uk':            { name: 'BBC',               credibility: 0.92, tier: 'premium' },
  'aninews.in':           { name: 'ANI News',          credibility: 0.90, tier: 'premium' },
  'thehindu.com':         { name: 'The Hindu',         credibility: 0.90, tier: 'premium' },
  'indianexpress.com':    { name: 'Indian Express',    credibility: 0.88, tier: 'news' },
  'timesofindia.indiatimes.com': { name: 'Times of India', credibility: 0.88, tier: 'news' },
  'economictimes.indiatimes.com': { name: 'Economic Times', credibility: 0.88, tier: 'news' },
  'pib.gov.in':           { name: 'PIB India',         credibility: 0.95, tier: 'institutional' },
  'factcheck.org':        { name: 'FactCheck.org',     credibility: 0.90, tier: 'factcheck' },
  'snopes.com':           { name: 'Snopes',            credibility: 0.88, tier: 'factcheck' },
  'politifact.com':       { name: 'PolitiFact',        credibility: 0.88, tier: 'factcheck' },
  'altnews.in':           { name: 'Alt News',          credibility: 0.88, tier: 'factcheck' },
  'bloomberg.com':        { name: 'Bloomberg',         credibility: 0.90, tier: 'premium' },
  'wsj.com':              { name: 'WSJ',               credibility: 0.90, tier: 'premium' },
  'nytimes.com':          { name: 'NY Times',          credibility: 0.88, tier: 'news' }
};

function getTrustedSourceInfo(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, info] of Object.entries(TRUSTED_DOMAINS)) {
      if (host === domain || host.endsWith('.' + domain)) return info;
    }
  } catch { return null; }
  return null;
}

async function buildNewsConsensus(verifiedClaims, claimStrings) {
  const startTime = Date.now();
  console.log('[liveNewsVerification] ⚖️ Synthesizing Multi-Source Consensus...');

  const EMPTY = {
    trustedConsensus:      'unsupported',
    consensusConfidence:   0,
    consensusSummary:      'No verified institutional evidence detected in current analysis window.',
    matchingCount:         0,
    contradictingCount:    0,
    credibilityAdjustment: 0,
    trustedSources:        []
  };

  try {
    if (!verifiedClaims || !verifiedClaims.length) return EMPTY;

    const trustedEvidence = extractTrustedEvidence(verifiedClaims);
    
    // If no premium evidence, apply graceful degradation
    if (trustedEvidence.length === 0) {
      return { ...EMPTY, consensusSummary: 'Narrative signals found but no direct institutional matches detected.' };
    }

    // High-Fidelity Consensus Analysis
    const consensusData = await analyzeConsensusWithGroq(claimStrings, trustedEvidence)
      || buildHeuristicConsensus(verifiedClaims, trustedEvidence);

    return {
      ...consensusData,
      trustedSources: trustedEvidence.slice(0, 10),
      metadata: { processingTimeMs: Date.now() - startTime }
    };
  } catch (err) {
    console.warn('[liveNewsVerification] ❌ Consensus engine failed:', err.message);
    return EMPTY;
  }
}

function extractTrustedEvidence(verifiedClaims) {
  const seen = new Set();
  const trusted = [];

  for (const vc of verifiedClaims) {
    for (const ev of (vc.evidence || [])) {
      if (!ev.url || seen.has(ev.url)) continue;
      const sourceInfo = getTrustedSourceInfo(ev.url);
      if (!sourceInfo) continue;
      
      seen.add(ev.url);
      trusted.push({
        claim: vc.claim,
        claimVerdict: vc.verdict,
        source: sourceInfo.name,
        tier: sourceInfo.tier,
        credibility: sourceInfo.credibility,
        title: ev.title || '',
        snippet: ev.snippet || '',
        url: ev.url
      });
    }
  }
  return trusted.sort((a, b) => b.credibility - a.credibility);
}

async function analyzeConsensusWithGroq(claims, trustedEvidence) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const prompt = `
    Persona: Investigative Consensus Editor.
    Task: Analyze trusted news evidence and determine narrative alignment.
    
    Claims:
    ${claims.slice(0, 5).map((c, i) => `${i+1}. ${c}`).join('\n')}
    
    Evidence:
    ${trustedEvidence.slice(0, 8).map((e, i) => `[${i+1}] ${e.source}: ${e.snippet}`).join('\n')}
    
    Output JSON ONLY:
    {
      "trusted_consensus": "confirmed | partially_confirmed | disputed | unsupported",
      "consensus_confidence": 0-100,
      "consensus_summary": "Professional executive summary",
      "matching_count": number,
      "contradicting_count": number,
      "credibility_adjustment": -30 to +10
    }
  `;

  try {
    const response = await axios.post(GROQ_API_URL, {
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    }, {
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 8000
    });

    const parsed = JSON.parse(response.data.choices[0].message.content);
    return {
      trustedConsensus: parsed.trusted_consensus,
      consensusConfidence: parsed.consensus_confidence,
      consensusSummary: parsed.consensus_summary,
      matchingCount: parsed.matching_count,
      contradictingCount: parsed.contradicting_count,
      credibilityAdjustment: parsed.credibility_adjustment
    };
  } catch (err) { return null; }
}

function buildHeuristicConsensus(verifiedClaims, trustedEvidence) {
  const supporting = trustedEvidence.filter(e => ['True', 'Mostly True'].includes(e.claimVerdict)).length;
  const contradicting = trustedEvidence.filter(e => ['Misleading', 'False'].includes(e.claimVerdict)).length;
  
  return {
    trustedConsensus: contradicting > 0 ? 'disputed' : supporting > 1 ? 'confirmed' : 'partially_confirmed',
    consensusConfidence: 50,
    consensusSummary: `Detected narrative patterns across ${trustedEvidence.length} trusted reports.`,
    matchingCount: supporting,
    contradictingCount: contradicting,
    credibilityAdjustment: supporting > 1 ? 5 : contradicting > 0 ? -15 : 0
  };
}

module.exports = { buildNewsConsensus };
