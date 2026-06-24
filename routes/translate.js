const express    = require('express')
const router     = express.Router()
const { translate } = require('../controllers/translateController')

router.post('/translate', translate)

module.exports = router
