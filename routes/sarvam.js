const express = require('express');
const router = express.Router();
const { textToSpeech, speechToText } = require('../controllers/sarvamController');

router.post('/tts', textToSpeech);
router.post('/stt', speechToText);

module.exports = router;
