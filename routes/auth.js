const express = require('express')
const router  = express.Router()
const { signup, login, getProfile } = require('../controllers/authController')
const auth = require('../controllers/authMiddleware')

router.post('/auth/signup',   signup)
router.post('/auth/register', signup)  // alias for register
router.post('/auth/login',    login)
router.get('/auth/profile',   auth, getProfile)
router.get('/user/profile',   auth, getProfile)  // alias

module.exports = router
