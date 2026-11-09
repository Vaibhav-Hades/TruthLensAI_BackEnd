const supabase = require('../config/supabase')
const { getLiveDashboardData } = require('../services/misinformationDashboardService')

// ── GET /api/admin/dashboard ──────────────────────────────────────────────────
// All numbers come from Supabase (analyses, flags, sources). Nothing is fabricated:
// if a table is missing or empty the corresponding values are 0 / empty arrays.
// (Previously this endpoint returned hard-coded demo statistics.)

function bucketLabel(i) {
  return ['Critical', 'Very Low', 'Low', 'Low', 'Medium', 'Medium', 'Medium', 'High', 'High', 'Trusted'][i]
}

async function safeRows(query) {
  try {
    const { data, error } = await query
    if (error) { console.warn('[admin] query skipped:', error.message); return [] }
    return data || []
  } catch (e) { console.warn('[admin] query failed:', e.message); return [] }
}

const getDashboard = async function(req, res, next) {
  try {
    let sourceCount = 0
    try {
      const { count, error } = await supabase.from('sources').select('*', { count: 'exact', head: true })
      if (!error) sourceCount = count || 0
    } catch (e) { /* DB may be empty */ }

    const dayMs = 24 * 60 * 60 * 1000
    const since = new Date(Date.now() - 14 * dayMs).toISOString()
    const analyses = await safeRows(
      supabase.from('analyses').select('input_ref, content_type, prediction, truth_score, created_at')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
    )
    const flags = await safeRows(
      supabase.from('flags').select('video_url, reasons, summary, status, community_count, created_at')
        .order('created_at', { ascending: false }).limit(500)
    )

    const totalAnalyses = analyses.length
    const fakeNewsDetected = analyses.filter(a => a.prediction === 'FAKE').length
    const trustedContent = analyses.filter(a => a.prediction === 'REAL').length
    const questionable = totalAnalyses - fakeNewsDetected - trustedContent
    const scores = analyses.map(a => a.truth_score).filter(n => typeof n === 'number')
    const avgTruthScore = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0

    const age = (a) => Date.now() - new Date(a.created_at).getTime()
    const last24 = analyses.filter(a => age(a) < dayMs)
    const prev24 = analyses.filter(a => age(a) >= dayMs && age(a) < 2 * dayMs)
    const change = prev24.length ? Math.round(((last24.length - prev24.length) / prev24.length) * 100) : null

    const scoreDistribution = Array.from({ length: 10 }, (_, i) => ({
      range: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`,
      count: scores.filter(n => (i === 9 ? n >= 90 : n >= i * 10 && n < i * 10 + 10)).length,
      label: bucketLabel(i),
    }))

    const platformDefs = [
      { key: 'video', platform: 'YouTube', color: '#ef4444' },
      { key: 'article', platform: 'News Article', color: '#10b981' },
      { key: 'text', platform: 'Manual Claim', color: '#a78bfa' },
    ]
    const platformBreakdown = platformDefs.map(p => {
      const count = analyses.filter(a => a.content_type === p.key).length
      return { platform: p.platform, count, pct: totalAnalyses ? Math.round((count / totalAnalyses) * 100) : 0, color: p.color }
    })
    const topPlatform = [...platformBreakdown].sort((a, b) => b.count - a.count)[0]

    const dailyActivity = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
      const next = new Date(d.getTime() + dayMs)
      const inDay = (x) => { const t = new Date(x.created_at); return t >= d && t < next }
      dailyActivity.push({
        date: d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
        iso: d.toISOString(),
        analyses: analyses.filter(inDay).length,
        flagged: flags.filter(inDay).length,
      })
    }

    const verdictLabel = { REAL: 'Trusted', FAKE: 'High Risk', MISLEADING: 'Questionable', INCONCLUSIVE: 'Questionable' }
    const typeName = { video: 'YouTube', article: 'News Article', text: 'Manual Claim' }
    const recentActivities = analyses.slice(0, 8).map((a, i) => ({
      id: 'act_' + i,
      title: a.input_ref && a.input_ref !== '[text input]' ? a.input_ref : 'Pasted text claim',
      platform: typeName[a.content_type] || 'Other',
      score: a.truth_score,
      verdict: verdictLabel[a.prediction] || 'Questionable',
      timestamp: a.created_at,
    }))

    const byUrl = new Map()
    for (const f of flags) {
      const cur = byUrl.get(f.video_url) || { claim: f.summary || f.video_url, flags: 0, reasons: [] }
      cur.flags += 1
      cur.reasons.push(...(f.reasons || []))
      byUrl.set(f.video_url, cur)
    }
    const trendingClaims = [...byUrl.values()].sort((a, b) => b.flags - a.flags).slice(0, 5).map((c, i) => ({
      id: 'tc' + (i + 1), claim: c.claim, flags: c.flags,
      risk: c.flags >= 5 ? 'HIGH' : c.flags >= 2 ? 'MEDIUM' : 'LOW',
      category: c.reasons[0] || 'Flagged',
    }))

    return res.status(200).json({
      totalAnalyses, fakeNewsDetected, trustedContent, questionable,
      averageTruthScore: avgTruthScore,
      topPlatform: totalAnalyses ? topPlatform.platform : 'N/A',
      sourcesInDB: sourceCount,
      activeAlerts: flags.filter(f => f.status === 'pending').length,
      last24hAnalyses: last24.length,
      last24hChange: change === null ? 'n/a' : `${change >= 0 ? '+' : ''}${change}%`,
      scoreDistribution, platformBreakdown, dailyActivity, recentActivities, trendingClaims,
      windowDays: 14,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    next(err)
  }
}

// ── GET /api/dashboard/trends ─────────────────────────────────────────────────
const getTrendsDashboard = async function(req, res, next) {
  try {
    const liveData = await getLiveDashboardData()
    return res.status(200).json(liveData)
  } catch (err) {
    next(err)
  }
}

module.exports = { getDashboard, getTrendsDashboard }
