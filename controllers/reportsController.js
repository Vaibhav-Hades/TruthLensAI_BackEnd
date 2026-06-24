const supabase = require('../config/supabase')

// ── Helpers ───────────────────────────────────────────────────────────────────
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false
  const trimmed = str.trim()
  return /^https?:\/\//i.test(trimmed) || trimmed.length >= 10
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val))
}

// ── POST /api/reports/save (protected) ───────────────────────────────────────
// Upserts a report row in the Supabase "reports" table.
// Ownership: req.user.id comes from authMiddleware (JWT-verified Supabase user).
const saveReport = async function(req, res, next) {
  try {
    const {
      videoUrl, videoId, thumbnail,
      truthScore, summary, meaning,
      matchedSources, contentType, platformId,
    } = req.body

    // ── Validation ────────────────────────────────────────────────────────────
    if (!videoUrl || !isValidUrl(videoUrl)) {
      return res.status(400).json({ error: 'A valid url is required.', errorCode: 'INVALID_URL' })
    }
    if (typeof truthScore !== 'number' || isNaN(truthScore)) {
      return res.status(400).json({ error: 'truth_score must be a number.', errorCode: 'INVALID_SCORE' })
    }

    const userId    = req.user.id
    const cleanUrl  = videoUrl.trim().slice(0, 2048)
    const score     = clamp(Math.round(truthScore), 0, 100)
    const cleanSummary = (summary || '').trim().slice(0, 500)

    // Sanitise sources array for JSON storage
    const sources = Array.isArray(matchedSources)
      ? matchedSources.slice(0, 5).map(s => ({
          label:      String(s.label || '').slice(0, 200),
          url:        String(s.url   || '').slice(0, 512),
          similarity: typeof s.similarity === 'number' ? s.similarity : null,
        }))
      : []

    const thumb = thumbnail
      ? String(thumbnail).slice(0, 512)
      : (videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null)

    // ── Upsert: update if same user + url already exists ──────────────────────
    // Supabase upsert on (user_id, url) unique constraint
    const { data: saved, error: upsertErr } = await supabase
      .from('reports')
      .upsert(
        {
          user_id:      userId,
          url:          cleanUrl,
          truth_score:  score,
          summary:      cleanSummary,
          meaning:      (meaning || '').trim().slice(0, 500),
          sources:      sources,          // stored as JSONB
          thumbnail:    thumb,
          video_id:     videoId ? String(videoId).slice(0, 20) : null,
          content_type: ['video', 'article', 'text'].includes(contentType) ? contentType : 'video',
          platform_id:  String(platformId || 'youtube').slice(0, 30),
          created_at:   new Date().toISOString(),
        },
        { onConflict: 'user_id,url', ignoreDuplicates: false }
      )
      .select('id, url, truth_score, summary, sources, thumbnail, created_at')
      .single()

    if (upsertErr) {
      console.error('Supabase upsert error:', upsertErr.message)
      return next(new Error('Failed to save report.'))
    }

    return res.status(200).json({ success: true, report: saved })
  } catch (err) {
    next(err)
  }
}

// ── GET /api/reports/history (protected) ─────────────────────────────────────
// Returns all reports for the authenticated user, newest first.
const getHistory = async function(req, res, next) {
  try {
    const userId = req.user.id

    const { data: reports, error } = await supabase
      .from('reports')
      .select('id, url, truth_score, summary, meaning, sources, thumbnail, video_id, content_type, platform_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Supabase history error:', error.message)
      return next(new Error('Failed to fetch report history.'))
    }

    const list     = reports || []
    const total    = list.length
    const avgScore = total
      ? Math.round(list.reduce((s, r) => s + (r.truth_score || 0), 0) / total)
      : 0

    // Normalise field names to match what the frontend expects
    const normalised = list.map(r => ({
      _id:           r.id,
      videoUrl:      r.url,
      truthScore:    r.truth_score,
      summary:       r.summary,
      meaning:       r.meaning,
      matchedSources: r.sources || [],
      thumbnail:     r.thumbnail,
      videoId:       r.video_id,
      contentType:   r.content_type,
      platformId:    r.platform_id,
      savedAt:       r.created_at,
    }))

    return res.status(200).json({
      reports: normalised,
      stats: {
        total,
        avgScore,
        highRisk: list.filter(r => (r.truth_score || 0) < 40).length,
        trusted:  list.filter(r => (r.truth_score || 0) >= 70).length,
      },
    })
  } catch (err) {
    next(err)
  }
}

// ── DELETE /api/reports/:id (protected) ──────────────────────────────────────
// Ownership enforced: WHERE id = :id AND user_id = req.user.id
const deleteReport = async function(req, res, next) {
  try {
    const { id } = req.params

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Report ID is required.', errorCode: 'MISSING_ID' })
    }

    const { data, error } = await supabase
      .from('reports')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)   // ownership check — cannot delete another user's report
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Supabase delete error:', error.message)
      return next(new Error('Failed to delete report.'))
    }

    if (!data) {
      return res.status(404).json({ error: 'Report not found.', errorCode: 'NOT_FOUND' })
    }

    return res.status(200).json({ success: true, deletedId: id })
  } catch (err) {
    next(err)
  }
}

module.exports = { saveReport, getHistory, deleteReport }
