const express = require('express')
const router  = express.Router()
const { signup, login, getProfile } = require('../controllers/authController')
const auth = require('../controllers/authMiddleware')
const requireDb = require('../middleware/requireDb')

router.post('/auth/signup',   requireDb, signup)
router.post('/auth/register', requireDb, signup)  // alias for register
router.post('/auth/login',    requireDb, login)
router.get('/auth/profile',   requireDb, auth, getProfile)
router.get('/user/profile',   requireDb, auth, getProfile)  // alias

module.exports = router
