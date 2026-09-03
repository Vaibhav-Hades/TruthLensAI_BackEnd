const { generateAnswer } = require('../services/chatService')

// POST /api/chat
const chat = async function(req, res, next) {
  try {
    const { message, question, analysisContext, history, language } = req.body
    const q = (message || question || '').trim()

    if (!q) {
      return res.status(400).json({ error: 'A question is required.' })
    }

    // Support both old shape (summary/meaning/...) and new shape (analysisContext)
    let ctx = analysisContext || {
      summary:        req.body.summary,
      meaning:        req.body.meaning,
      truthScore:     req.body.truthScore,
      matchedSources: req.body.matchedSources,
    }

    // Fallback context for general queries when no video has been analyzed yet
    if (!ctx || (!ctx.summary && !ctx.meaning)) {
      ctx = {
        summary: 'General inquiry about TruthLens AI news verification platform.',
        meaning: 'General assistance',
        truthScore: 50,
        matchedSources: []
      }
    }

    const answer = await generateAnswer(q, ctx, history || [], language || 'en')
    return res.status(200).json({ reply: answer, answer })
  } catch (err) {
    next(err)
  }
}

module.exports = { chat }
