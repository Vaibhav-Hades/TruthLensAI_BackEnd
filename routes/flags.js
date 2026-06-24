const express = require('express')
const router  = express.Router()
const { saveFlag, getFlagCount, getAllFlags } = require('../controllers/flagsController')

router.post('/flags',        saveFlag)
router.get('/flags/count',   getFlagCount)
router.get('/flags',         getAllFlags)

module.exports = router
