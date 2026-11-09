const express = require('express')
const router = express.Router()
const { getLiveNews } = require('../services/liveNewsFeedService')

// GET /api/news/live?lang=en|hi|te|ta&category=all|politics|technology|global|ai|misinfo|economics&limit=18
router.get('/news/live', async (req, res, next) => {
  try {
    const data = await getLiveNews({ lang: req.query.lang, category: req.query.category, limit: req.query.limit })
    res.set('Cache-Control', 'public, max-age=30')
    res.json(data)
  } catch (err) { next(err) }
})

module.exports = router
