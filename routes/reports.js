const express = require('express')
const router  = express.Router()
const { saveReport, getHistory, deleteReport } = require('../controllers/reportsController')
const auth = require('../controllers/authMiddleware')
const requireDb = require('../middleware/requireDb')

router.post('/reports/save',    requireDb, auth, saveReport)
router.get('/reports/history',  requireDb, auth, getHistory)
router.delete('/reports/:id',   requireDb, auth, deleteReport)

module.exports = router
