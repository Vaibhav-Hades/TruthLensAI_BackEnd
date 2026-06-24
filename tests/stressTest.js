/**
 * stressTest.js
 *
 * PHASE 8 V2: Comprehensive Stress Testing & Real-World Validation Suite
 *
 * Covers:
 *  Category 1 — Political / controversial content
 *  Category 2 — No-subtitle video scenarios
 *  Category 3 — Multilingual content (Hindi, Telugu, Tamil, Hinglish)
 *  Category 4 — Long-form content (podcasts, interviews)
 *  Category 5 — Misinformation / contradiction detection
 *  Category 6 — Weak / low-coverage evidence
 *  Category 7 — Pipeline failure + fallback simulation
 *  Category 8 — Performance benchmarking
 *  Category 9 — Output consistency / determinism
 *
 * Usage:
 *   node stressTest.js                   → Run all categories
 *   node stressTest.js --category=3      → Run only category 3
 *   node stressTest.js --category=7      → Run failure simulation
 *   node stressTest.js --quick           → Run abbreviated smoke test
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { runPhase2Intelligence } = require('../services/intelligenceService');
const { runSemanticVerification } = require('../services/semanticService');
const { generateCredibilityReport } = require('../services/credibilityService');
const { createTimer, emit } = require('../utils/pipelineLogger');

// ── CLI Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CATEGORY = args.find(a => a.startsWith('--category='))?.split('=')[1];
const QUICK = args.includes('--quick');

// ── Test Results Tracker ──────────────────────────────────────────────────────
const results = { passed: 0, failed: 0, warnings: 0, skipped: 0, details: [] };

function pass(name, meta = {}) {
  results.passed++;
  results.details.push({ status: 'PASS', name, ...meta });
  emit('INFO', 'test', `✅ PASS — ${name}`, meta);
}

function fail(name, reason, meta = {}) {
  results.failed++;
  results.details.push({ status: 'FAIL', name, reason, ...meta });
  emit('ERROR', 'test', `❌ FAIL — ${name}: ${reason}`, meta);
}

function warn(name, message, meta = {}) {
  results.warnings++;
  results.details.push({ status: 'WARN', name, message, ...meta });
  emit('WARN', 'test', `⚠️  WARN — ${name}: ${message}`, meta);
}

function skip(name) {
  results.skipped++;
  emit('INFO', 'test', `⏭  SKIP — ${name}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURES = {

  // CATEGORY 1 — Political Content
  political: [
    {
      name: 'Modi Election Speech (EN)',
      chunks: [
        "Prime Minister Narendra Modi addressed a rally in Varanasi, claiming that the BJP government has built more roads than all previous governments combined since independence. He cited figures suggesting 45,000 km of national highways constructed in the last 10 years. He also announced a new welfare scheme for farmers worth 6 lakh crore rupees.",
        "Opposition parties including Congress and AAP challenged these statistics, alleging that road construction data was misleadingly presented and excluded state highways built under central grants. Congress spokesperson stated that the actual new construction is significantly lower when accounting for widening of existing roads."
      ]
    },
    {
      name: 'Rahul Gandhi Alliance Statement (EN)',
      chunks: [
        "Rahul Gandhi at a INDIA Alliance press conference stated that the BJP is attempting to dismantle democratic institutions including the Election Commission and CBI. He cited recent appointment controversies and alleged that sitting judges are under pressure. He called for a special parliamentary session.",
        "BJP responded calling the allegations baseless and politically motivated, pointing to Supreme Court rulings that upheld the independence of constitutional bodies. Home Minister Amit Shah said the claims were aimed at disrupting governance before the upcoming state elections."
      ]
    }
  ],

  // CATEGORY 2 — No-subtitle / audio-only simulation
  noSubtitle: [
    {
      name: 'Noisy Rally Audio Simulation',
      // Simulates degraded Whisper output from a noisy event recording
      chunks: [
        "[low quality audio] ...governm... scheme... farmer... rupees... [inaudible]... opposition... [crowd noise]... election... BJP... 2024... [audio dropout]",
        "We have seen [static] development in... [unintelligible] roads... and infrastructure... across every state... [crowd cheering]... vote for progress..."
      ]
    },
    {
      name: 'Regional Language With Accent (Telugu Mix)',
      chunks: [
        "Mana telugu vaalaki chala important news undi. Government oka naya scheme announce chesindi, deeniki vallaki direct benefit istundi. Farmers ki direct 6000 rupees iyyi annual ga. Ee scheme gurinchi opposition strongly oppose chestundi.",
      ]
    }
  ],

  // CATEGORY 3 — Multilingual
  multilingual: [
    {
      name: 'Hindi Political Discourse',
      chunks: [
        "प्रधानमंत्री मोदी ने आज संसद में कहा कि भारत 2047 तक विकसित राष्ट्र बनेगा। उन्होंने बताया कि पिछले 10 वर्षों में 5 करोड़ से अधिक घर गरीबों को दिए गए। विपक्षी दलों ने इन आंकड़ों को भ्रामक बताया।",
        "राहुल गांधी ने कहा कि सरकार के दावे झूठे हैं और वास्तविकता यह है कि गरीबी बढ़ी है। कांग्रेस ने एक श्वेत पत्र जारी करने की मांग की।"
      ]
    },
    {
      name: 'Tamil News Report',
      chunks: [
        "தமிழ்நாடு அரசு புதிய திட்டம் அறிவித்துள்ளது. இந்த திட்டத்தின் கீழ் விவசாயிகளுக்கு நேரடி நிதி உதவி வழங்கப்படும். மாற்று கட்சிகள் இந்த அறிவிப்பை விமர்சித்துள்ளன.",
        "முதலமைச்சர் ஸ்டாலின் கூறினார் இந்த திட்டம் 50 லட்சம் குடும்பங்களுக்கு நன்மை செய்யும். BJP எதிர்க்கட்சி மத்திய அரசின் திட்டங்களை கடைப்பிடிக்க வேண்டும் என்று கூறியது."
      ]
    },
    {
      name: 'Hinglish Mixed Code',
      chunks: [
        "Yaar sun, aaj news mein dekha ki government ne ek naya scheme launch kiya hai, especially farmers ke liye. Koi 6000 rupees annually milenge har family ko. But opposition ka kehna hai ki yeh sirf political gimmick hai before elections.",
        "Matlab dekho, hum log har baar same cheez sun rahe hain before elections. Is baar bhi same hi ho raha hai. Lekin BBC aur Reuters ne report kiya ki actual implementation pichle schemes mein bahut kam thi."
      ]
    }
  ],

  // CATEGORY 4 — Long content / podcast simulation
  longForm: [
    {
      name: '90-Minute Podcast Simulation',
      chunks: (() => {
        // Simulate 18 chunks (approx 5-min segments of a 90-min podcast)
        const baseTopics = [
          "The host opened the discussion by exploring how India's foreign policy has shifted over the past decade, particularly towards a more assertive multilateralism.",
          "The guest, a former diplomat, argued that the Quad alliance has strengthened India's position in the Indo-Pacific while managing tensions with China.",
          "They discussed how the Russia-Ukraine conflict has affected India's diplomatic balancing act, with India abstaining from multiple UN votes.",
          "The conversation turned to trade deficits, with the host noting that India's imports from China continue to rise despite geopolitical tensions.",
          "Border disputes in Ladakh were discussed in detail, with the guest cautioning that recent disengagement is fragile.",
          "The host raised the question of election influence and media narratives, which the guest said is a growing concern globally.",
          "Discussion of AI regulations in India and the government's draft AI policy framework came next.",
          "Economic reforms, GST compliance, and tax broadening were covered with references to IMF projections.",
          "The episode ended with a discussion on India's 2047 Viksit Bharat vision and whether structural reforms are matching the ambition."
        ];
        return baseTopics;
      })()
    }
  ],

  // CATEGORY 5 — Misinformation / contradictions
  misinformation: [
    {
      name: 'Fabricated Claim — Fake Statistic',
      chunks: [
        "A viral video claims that the Indian government has secretly purchased $900 billion worth of gold from Switzerland and hidden it in a secret vault beneath the RBI headquarters in Mumbai. The video claims this was confirmed by a Wikileaks document from 2023.",
        "Multiple fact-checkers including FactCheck.org India, AltNews, and Boom have verified that no such Wikileaks document exists. The RBI categorically denied the claim. The video was traced to a known satire account that had been misrepresented as news."
      ]
    },
    {
      name: 'Misleading Framing — Cherry-Picked Data',
      chunks: [
        "A news channel reported that unemployment in India has reached its lowest level in 50 years, citing CMIE data showing a 3% urban unemployment rate.",
        "Economists have pointed out that this figure excludes disguised unemployment, underemployment, and those who have given up looking for work. The NSSO's broader measure puts effective unemployment much higher. The framing omits crucial context about labor force participation rates which have fallen sharply."
      ]
    },
    {
      name: 'Contradictory Narratives — Health Claim',
      chunks: [
        "A popular YouTube channel claimed that the Indian government has approved a new drug that cures Type 2 diabetes completely with a single injection, citing an unnamed research paper.",
        "ICMR and AIIMS have issued clarifications that no such drug has been approved or reviewed. The so-called research paper cannot be found in any indexed medical journal. Endocrinologists interviewed by The Hindu called the claim dangerous misinformation that could stop patients from taking actual medication."
      ]
    }
  ],

  // CATEGORY 6 — Weak / low coverage topics
  weakEvidence: [
    {
      name: 'Hyper-Local Event — Low Archive Coverage',
      chunks: [
        "A panchayat election in Chittoor district of Andhra Pradesh saw allegations of booth capturing during a by-election for ward 14. Local party workers from TDP and YSRCP exchanged allegations. Police registered an FIR.",
      ]
    },
    {
      name: 'Obscure Cultural Claim',
      chunks: [
        "A video claims that the ancient temple of Murudeshwar in Karnataka was built 3,000 years ago using a construction technique rediscovered only recently by NASA engineers. The video says modern science has finally validated ancient Indian wisdom.",
      ]
    }
  ]
};

// ── Core Test Runner ──────────────────────────────────────────────────────────

async function runIntelligenceTest(fixture) {
  const t = createTimer();
  try {
    const result = await runPhase2Intelligence({
      chunks: fixture.chunks,
      cleanedTranscript: fixture.chunks.join('\n')
    });

    const elapsedMs = t.elapsed();

    // Assertions
    if (!result.summary || result.summary.length < 20) {
      fail(fixture.name, 'Summary too short or empty', { summary: result.summary });
      return null;
    }
    if (!Array.isArray(result.keywords) || result.keywords.length === 0) {
      warn(fixture.name, 'No keywords extracted — retrieval may be weak');
    }
    if (!Array.isArray(result.claims) || result.claims.length === 0) {
      warn(fixture.name, 'No claims extracted — contradiction detection may be degraded');
    }
    if (elapsedMs > 20000) {
      warn(fixture.name, `Slow intelligence stage: ${elapsedMs}ms`, { elapsedMs });
    }

    pass(fixture.name, {
      summaryLength: result.summary.length,
      keywords: result.keywords.length,
      claims: result.claims.length,
      elapsedMs
    });
    return result;
  } catch (err) {
    fail(fixture.name, err.message, { stack: err.stack?.slice(0, 200) });
    return null;
  }
}

async function runSemanticTest(fixture, intelligenceResult) {
  if (!intelligenceResult) return null;
  const t = createTimer();
  try {
    const articles = [
      {
        title: `External report on: ${fixture.name}`,
        summary: `Trusted institutional reporting related to the narrative. Key context verified. Sources include Reuters, BBC, and AP News.`,
        source: 'Reuters',
        url: 'https://reuters.com/test',
        relevanceScore: 78
      }
    ];

    const result = await runSemanticVerification(
      intelligenceResult.summary,
      intelligenceResult.claims,
      articles
    );

    const elapsedMs = t.elapsed();

    if (typeof result.narrativeAlignment !== 'number') {
      fail(fixture.name + ' (semantic)', 'narrativeAlignment missing or non-numeric');
      return null;
    }
    if (!result.contradictionLevel) {
      fail(fixture.name + ' (semantic)', 'contradictionLevel not returned');
      return null;
    }
    if (elapsedMs > 15000) {
      warn(fixture.name + ' (semantic)', `Slow semantic stage: ${elapsedMs}ms`);
    }

    pass(fixture.name + ' (semantic)', {
      narrativeAlignment: result.narrativeAlignment,
      contradictionLevel: result.contradictionLevel,
      elapsedMs
    });
    return result;
  } catch (err) {
    fail(fixture.name + ' (semantic)', err.message);
    return null;
  }
}

// ── Category Runners ──────────────────────────────────────────────────────────

async function runCategory(label, fixtures, { skipSemantic = false } = {}) {
  emit('INFO', 'suite', `\n${'─'.repeat(60)}\n  CATEGORY: ${label}\n${'─'.repeat(60)}`);
  for (const fixture of fixtures) {
    const intel = await runIntelligenceTest(fixture);
    if (!skipSemantic && intel) {
      await runSemanticTest(fixture, intel);
    }
  }
}

// ── Category 7 — Pipeline Failure Simulation ──────────────────────────────────

async function runFailureSimulation() {
  emit('INFO', 'suite', '\n' + '─'.repeat(60) + '\n  CATEGORY 7: Pipeline Failure Simulation\n' + '─'.repeat(60));

  // Test 1: Empty transcript
  try {
    await runPhase2Intelligence({ chunks: [], cleanedTranscript: '' });
    fail('Empty transcript', 'Should have thrown an error for empty chunks');
  } catch (err) {
    pass('Empty transcript error handling', { error: err.message });
  }

  // Test 2: Malformed chunk data
  try {
    const result = await runPhase2Intelligence({
      chunks: [''], 
      cleanedTranscript: ''
    });
    // If it returns without throwing, verify graceful fallback
    if (result && result.verdict_label) {
      pass('Malformed input graceful fallback', { verdict: result.verdict_label });
    } else {
      warn('Malformed input', 'Result returned but without expected structure');
    }
  } catch (err) {
    pass('Malformed input throws cleanly', { error: err.message.slice(0, 80) });
  }

  // Test 3: Very long single chunk
  try {
    const longText = 'India news '.repeat(3000); // ~33,000 chars
    const result = await runPhase2Intelligence({
      chunks: [longText],
      cleanedTranscript: longText
    });
    if (result?.summary) {
      pass('Long chunk handling', { summaryLen: result.summary.length });
    } else {
      warn('Long chunk', 'No summary returned from very long input');
    }
  } catch (err) {
    warn('Long chunk error', err.message.slice(0, 100));
  }

  // Test 4: Unicode / special characters
  try {
    const unicodeText = '🔥 भारत Government ने 💰 announce किया 🎯 scheme for farmers ✅';
    const result = await runPhase2Intelligence({
      chunks: [unicodeText],
      cleanedTranscript: unicodeText
    });
    if (result?.summary) {
      pass('Unicode / emoji chunk handling', { summaryLen: result.summary.length });
    } else {
      warn('Unicode chunk', 'No summary for unicode input');
    }
  } catch (err) {
    warn('Unicode chunk error', err.message.slice(0, 100));
  }

  emit('INFO', 'suite', 'Failure simulation complete.');
}

// ── Category 9 — Output Consistency ──────────────────────────────────────────

async function runConsistencyTest() {
  emit('INFO', 'suite', '\n' + '─'.repeat(60) + '\n  CATEGORY 9: Output Consistency\n' + '─'.repeat(60));

  const fixture = FIXTURES.political[0];
  const RUN_COUNT = QUICK ? 2 : 3;

  const summaries = [];
  const verdicts = [];

  for (let i = 0; i < RUN_COUNT; i++) {
    try {
      const result = await runPhase2Intelligence({
        chunks: fixture.chunks,
        cleanedTranscript: fixture.chunks.join('\n')
      });
      summaries.push(result.summary?.slice(0, 100));
      verdicts.push(result.verdict_label);
      emit('INFO', 'consistency', `Run ${i + 1}/${RUN_COUNT}: verdict=${result.verdict_label}`);
    } catch (err) {
      fail(`Consistency run ${i + 1}`, err.message);
    }
    // Wait 2s between runs to avoid rate limits
    if (i < RUN_COUNT - 1) await new Promise(r => setTimeout(r, 2000));
  }

  // Check verdict consistency
  const uniqueVerdicts = new Set(verdicts);
  if (uniqueVerdicts.size === 1) {
    pass('Verdict consistency', { verdict: verdicts[0], runs: RUN_COUNT });
  } else {
    warn('Verdict inconsistency', `Got ${uniqueVerdicts.size} different verdicts across ${RUN_COUNT} runs`, {
      verdicts
    });
  }

  // Check summary consistency (rough token overlap)
  if (summaries.length >= 2) {
    const wordsA = new Set(summaries[0]?.split(' ') || []);
    const wordsB = summaries[1]?.split(' ') || [];
    const overlap = wordsB.filter(w => wordsA.has(w)).length;
    const overlapPct = Math.round((overlap / Math.max(wordsA.size, 1)) * 100);

    if (overlapPct > 40) {
      pass('Summary consistency', { overlapPercent: overlapPct });
    } else {
      warn('Summary consistency low', `Only ${overlapPct}% token overlap between runs`);
    }
  }
}

// ── Category 8 — Performance Benchmarks ──────────────────────────────────────

async function runPerformanceBenchmark() {
  emit('INFO', 'suite', '\n' + '─'.repeat(60) + '\n  CATEGORY 8: Performance Benchmarks\n' + '─'.repeat(60));

  const THRESHOLDS = {
    intelligenceMs: 20000,
    semanticMs: 15000,
    totalMs: 40000
  };

  const fixture = FIXTURES.political[0];
  const globalTimer = createTimer();

  const intelTimer = createTimer();
  const intel = await runIntelligenceTest(fixture);
  const intelMs = intelTimer.elapsed();

  const semanticTimer = createTimer();
  if (intel) await runSemanticTest(fixture, intel);
  const semanticMs = semanticTimer.elapsed();

  const totalMs = globalTimer.elapsed();

  // Emit benchmark report
  emit('INFO', 'benchmark', 'Performance results', {
    intelligenceMs: intelMs,
    semanticMs: semanticMs,
    totalMs: totalMs,
    intelligenceThreshold: THRESHOLDS.intelligenceMs,
    semanticThreshold: THRESHOLDS.semanticMs
  });

  if (intelMs < THRESHOLDS.intelligenceMs) {
    pass('Intelligence speed', { ms: intelMs, threshold: THRESHOLDS.intelligenceMs });
  } else {
    warn('Intelligence slow', `${intelMs}ms exceeds ${THRESHOLDS.intelligenceMs}ms threshold`);
  }

  if (semanticMs < THRESHOLDS.semanticMs) {
    pass('Semantic speed', { ms: semanticMs, threshold: THRESHOLDS.semanticMs });
  } else {
    warn('Semantic slow', `${semanticMs}ms exceeds ${THRESHOLDS.semanticMs}ms threshold`);
  }

  if (totalMs < THRESHOLDS.totalMs) {
    pass('Total pipeline speed', { ms: totalMs, threshold: THRESHOLDS.totalMs });
  } else {
    warn('Total pipeline slow', `${totalMs}ms exceeds ${THRESHOLDS.totalMs}ms threshold`);
  }
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

async function main() {
  const globalTimer = createTimer();

  emit('INFO', 'suite', '═'.repeat(65));
  emit('INFO', 'suite', '  TruthLens AI — Stress Test & Validation Suite (Phase 8 V2)');
  emit('INFO', 'suite', `  Mode: ${QUICK ? 'QUICK' : 'FULL'} | Category: ${CATEGORY || 'ALL'}`);
  emit('INFO', 'suite', '═'.repeat(65));

  const shouldRun = (cat) => !CATEGORY || CATEGORY === String(cat);

  if (shouldRun(1)) await runCategory('Category 1 — Political Content', FIXTURES.political);
  if (shouldRun(2)) await runCategory('Category 2 — No-Subtitle / Low Audio', FIXTURES.noSubtitle, { skipSemantic: true });
  if (shouldRun(3)) await runCategory('Category 3 — Multilingual Content', FIXTURES.multilingual);
  if (shouldRun(4)) await runCategory('Category 4 — Long-Form Content', FIXTURES.longForm);
  if (shouldRun(5)) await runCategory('Category 5 — Misinformation / Contradictions', FIXTURES.misinformation);
  if (shouldRun(6)) await runCategory('Category 6 — Weak Evidence Scenarios', FIXTURES.weakEvidence, { skipSemantic: true });
  if (shouldRun(7)) await runFailureSimulation();
  if (shouldRun(8)) await runPerformanceBenchmark();
  if (shouldRun(9)) await runConsistencyTest();

  // ── Final Report ──────────────────────────────────────────────────────────
  const totalMs = globalTimer.elapsed();
  emit('INFO', 'suite', '\n' + '═'.repeat(65));
  emit('INFO', 'suite', '  FINAL RESULTS');
  emit('INFO', 'suite', '═'.repeat(65));

  console.log(`\n  ✅  PASSED   : ${results.passed}`);
  console.log(`  ❌  FAILED   : ${results.failed}`);
  console.log(`  ⚠️   WARNINGS : ${results.warnings}`);
  console.log(`  ⏭   SKIPPED  : ${results.skipped}`);
  console.log(`  ⏱   DURATION : ${(totalMs / 1000).toFixed(1)}s\n`);

  if (results.failed > 0) {
    console.log('  FAILED TESTS:');
    results.details.filter(d => d.status === 'FAIL').forEach(d => {
      console.log(`    • ${d.name}: ${d.reason}`);
    });
    console.log('');
  }

  if (results.warnings > 0) {
    console.log('  WARNINGS:');
    results.details.filter(d => d.status === 'WARN').forEach(d => {
      console.log(`    • ${d.name}: ${d.message || ''}`);
    });
    console.log('');
  }

  emit('INFO', 'suite', '═'.repeat(65));

  // Exit with error code if any tests failed
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  emit('ERROR', 'suite', 'Critical unhandled test runner failure', { error: err.message });
  process.exit(2);
});
