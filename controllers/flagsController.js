const supabase = require('../config/supabase')

// ── POST /api/flags ───────────────────────────────────────────────────────────
const saveFlag = async function(req, res, next) {
  try {
    const { videoUrl, videoId, reasons, note, truthScore, summary, userId } = req.body

    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'videoUrl is required.', errorCode: 'MISSING_URL' })
    }
    if (!Array.isArray(reasons) || reasons.length === 0) {
      return res.status(400).json({ error: 'At least one reason is required.', errorCode: 'MISSING_REASONS' })
    }
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required.', errorCode: 'MISSING_USER_ID' })
    }

    // Prevent duplicate flags from same anonymous user for same URL
    const { data: existing } = await supabase
      .from('flags')
      .select('id')
      .eq('video_url', videoUrl.trim().slice(0, 2048))
      .eq('user_id', userId.slice(0, 64))
      .maybeSingle()

    if (existing) {
      return res.status(409).json({ error: 'Already flagged.', errorCode: 'ALREADY_FLAGGED' })
    }

    // Count existing flags for this URL to compute community count
    const { count } = await supabase
      .from('flags')
      .select('*', { count: 'exact', head: true })
      .eq('video_url', videoUrl.trim().slice(0, 2048))

    const communityCount = (count || 0) + 1

    const { data: flag, error: insertErr } = await supabase
      .from('flags')
      .insert({
        video_url:       videoUrl.trim().slice(0, 2048),
        video_id:        videoId  ? String(videoId).slice(0, 20)  : null,
        reasons:         reasons.slice(0, 8),
        note:            (note || '').slice(0, 280),
        truth_score:     typeof truthScore === 'number' ? truthScore : null,
        summary:         (summary || '').slice(0, 200),
        user_id:         userId.slice(0, 64),
        status:          'pending',
        community_count: communityCount,
        created_at:      new Date().toISOString(),
      })
      .select('id, video_url, community_count, status, created_at')
      .single()

    if (insertErr) {
      console.error('Supabase flag insert error:', insertErr.message)
      return next(new Error('Failed to save flag.'))
    }

    return res.status(201).json({ success: true, flag, communityCount })
  } catch (err) {
    next(err)
  }
}

// ── GET /api/flags/count?url= ─────────────────────────────────────────────────
const getFlagCount = async function(req, res, next) {
  try {
    const { url } = req.query
    if (!url) return res.status(200).json({ count: 0, userFlagged: false })

    const { count } = await supabase
      .from('flags')
      .select('*', { count: 'exact', head: true })
      .eq('video_url', url.slice(0, 2048))

    const userId = req.query.userId
    let userFlagged = false
    if (userId) {
      const { data: mine } = await supabase
        .from('flags')
        .select('id')
        .eq('video_url', url.slice(0, 2048))
        .eq('user_id', userId.slice(0, 64))
        .maybeSingle()
      userFlagged = !!mine
    }

    return res.status(200).json({ count: count || 0, userFlagged })
  } catch (err) {
    next(err)
  }
}

// ── GET /api/flags — all flags (admin / reports dashboard) ────────────────────
const getAllFlags = async function(req, res, next) {
  try {
    const { data: flags, error } = await supabase
      .from('flags')
      .select('id, video_url, video_id, reasons, note, truth_score, summary, status, community_count, created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('Supabase flags fetch error:', error.message)
      return next(new Error('Failed to fetch flags.'))
    }

    const normalised = (flags || []).map(f => ({
      id:             f.id,
      videoUrl:       f.video_url,
      videoId:        f.video_id,
      thumbnail:      f.video_id ? `https://img.youtube.com/vi/${f.video_id}/mqdefault.jpg` : null,
      reasons:        f.reasons || [],
      note:           f.note,
      truthScore:     f.truth_score,
      summary:        f.summary,
      status:         f.status,
      communityCount: f.community_count,
      flaggedAt:      f.created_at,
    }))

    return res.status(200).json({ flags: normalised, total: normalised.length })
  } catch (err) {
    next(err)
  }
}

module.exports = { saveFlag, getFlagCount, getAllFlags }
