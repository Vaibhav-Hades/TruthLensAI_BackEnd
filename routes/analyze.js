const express = require('express')
const router = express.Router()
const { analyzeVideo } = require('../controllers/analyzeController')

router.post('/analyze', analyzeVideo)

module.exports = router
