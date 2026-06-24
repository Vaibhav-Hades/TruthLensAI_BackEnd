const express = require('express')
const router  = express.Router()
const { getDashboard, getTrendsDashboard } = require('../controllers/adminController')

router.get('/admin/dashboard',        getDashboard)
router.get('/dashboard/trends',       getTrendsDashboard)

module.exports = router
