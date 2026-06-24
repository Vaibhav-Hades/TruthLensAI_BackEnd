const supabase = require('../config/supabase')
const { getLiveDashboardData } = require('../services/misinformationDashboardService')

// ── Realistic mock activity feed ──────────────────────────────────────────────
// In production this would come from a Supabase analyses table.
// For hackathon: generated deterministically so it looks real every time.

function generateRecentActivities() {
  var platforms = ['YouTube', 'News Article', 'YouTube', 'YouTube', 'News Article', 'Manual Claim', 'YouTube', 'News Article']
  var scores    = [23, 78, 41, 12, 85, 67, 34, 91]
  var titles    = [
    'Viral political speech — deepfake suspected',
    'Reuters: Verified election coverage',
    'Health misinformation about vaccines',
    'Fake government scheme spreading on WhatsApp',
    'AP News: Verified climate report',
    'Claim: "5G causes cancer" — manual check',
    'Celebrity death hoax video',
    'BBC: Verified economic analysis',
  ]
  var now = Date.now()
  return titles.map(function(title, i) {
    return {
      id:        'act_' + i,
      title:     title,
      platform:  platforms[i],
      score:     scores[i],
      verdict:   scores[i] >= 70 ? 'Trusted' : scores[i] >= 40 ? 'Questionable' : 'High Risk',
      timestamp: new Date(now - i * 8 * 60 * 1000).toISOString(),
    }
  })
}

function generateTrendingClaims() {
  return [
    { id: 'tc1', claim: 'EVM machines were hacked in recent elections', flags: 847, risk: 'HIGH',   category: 'Politics'     },
    { id: 'tc2', claim: 'New cancer cure discovered using kitchen spice', flags: 623, risk: 'HIGH',   category: 'Health'       },
    { id: 'tc3', claim: 'AI will eliminate 90% of jobs by next year',    flags: 412, risk: 'MEDIUM', category: 'Technology'   },
    { id: 'tc4', claim: 'Government secretly adding chemicals to water',  flags: 389, risk: 'HIGH',   category: 'Conspiracy'   },
    { id: 'tc5', claim: 'Celebrity donated ₹10 crore to flood victims',  flags: 201, risk: 'MEDIUM', category: 'Entertainment'},
  ]
}

function generateScoreDistribution() {
  // Buckets: 0-9, 10-19, ..., 90-100
  return [
    { range: '0–9',   count: 45,  label: 'Critical' },
    { range: '10–19', count: 82,  label: 'Very Low'  },
    { range: '20–29', count: 134, label: 'Low'       },
    { range: '30–39', count: 98,  label: 'Low'       },
    { range: '40–49', count: 167, label: 'Medium'    },
    { range: '50–59', count: 203, label: 'Medium'    },
    { range: '60–69', count: 189, label: 'Medium'    },
    { range: '70–79', count: 241, label: 'High'      },
    { range: '80–89', count: 312, label: 'High'      },
    { range: '90–100',count: 189, label: 'Trusted'   },
  ]
}

function generatePlatformBreakdown() {
  return [
    { platform: 'YouTube',      count: 1240, pct: 48, color: '#ef4444' },
    { platform: 'News Article', count: 680,  pct: 26, color: '#10b981' },
    { platform: 'Manual Claim', count: 390,  pct: 15, color: '#a78bfa' },
    { platform: 'Twitter/X',    count: 180,  pct: 7,  color: '#60a5fa' },
    { platform: 'Other',        count: 100,  pct: 4,  color: '#64748b' },
  ]
}

function generateDailyActivity() {
  // Last 14 days
  var days = []
  var now  = new Date()
  for (var i = 13; i >= 0; i--) {
    var d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push({
      date:      d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      analyses:  Math.floor(120 + Math.random() * 180),
      flagged:   Math.floor(20  + Math.random() * 60),
    })
  }
  return days
}

// ── Main controller ───────────────────────────────────────────────────────────
const getDashboard = async function(req, res, next) {
  try {
    // Real data: count sources in Supabase
    var sourceCount = 0
    try {
      const { count, error } = await supabase
        .from('sources')
        .select('*', { count: 'exact', head: true })
      if (!error) sourceCount = count || 0
    } catch (e) { /* DB may be empty */ }

    // Derived analytics (realistic for demo)
    var totalAnalyses    = 2590
    var fakeNewsDetected = 847
    var trustedContent   = 1102
    var questionable     = totalAnalyses - fakeNewsDetected - trustedContent
    var avgTruthScore    = 54

    var payload = {
      // ── Summary stats ──
      totalAnalyses,
      fakeNewsDetected,
      trustedContent,
      questionable,
      averageTruthScore: avgTruthScore,
      topPlatform:       'YouTube',
      sourcesInDB:       sourceCount,
      activeAlerts:      12,
      last24hAnalyses:   143,
      last24hChange:     '+18%',

      // ── Charts ──
      scoreDistribution:  generateScoreDistribution(),
      platformBreakdown:  generatePlatformBreakdown(),
      dailyActivity:      generateDailyActivity(),

      // ── Feeds ──
      recentActivities:   generateRecentActivities(),
      trendingClaims:     generateTrendingClaims(),

      generatedAt: new Date().toISOString(),
    }

    return res.status(200).json(payload)
  } catch (err) {
    next(err)
  }
}

// ── GET /api/dashboard/trends ────────────────────────────────────────────────────────────────
const getTrendsDashboard = async function(req, res, next) {
  try {
    const liveData = await getLiveDashboardData()
    return res.status(200).json(liveData)
  } catch (err) {
    next(err)
  }
}

module.exports = { getDashboard, getTrendsDashboard }
