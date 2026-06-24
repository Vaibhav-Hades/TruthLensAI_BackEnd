const express = require('express')
const router  = express.Router()
const { saveReport, getHistory, deleteReport } = require('../controllers/reportsController')
const auth = require('../controllers/authMiddleware')

router.post('/reports/save',    auth, saveReport)
router.get('/reports/history',  auth, getHistory)
router.delete('/reports/:id',   auth, deleteReport)

module.exports = router
