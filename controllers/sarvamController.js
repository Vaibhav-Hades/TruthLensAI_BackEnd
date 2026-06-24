const sarvamService = require('../services/sarvamService');

/**
 * Sarvam AI Controller
 * Handles specialized Indian multilingual requests.
 */
const textToSpeech = async (req, res, next) => {
  try {
    const { text, language } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    // Map internal codes to Sarvam codes if necessary
    const langMap = { hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN' };
    const sarvamLang = langMap[language] || 'hi-IN';

    const audioBase64 = await sarvamService.textToSpeech(text, sarvamLang);
    res.json({ audio: audioBase64 });
  } catch (err) {
    console.error('Sarvam TTS Controller Error:', err.message);
    res.status(500).json({ error: 'Sarvam TTS generation failed' });
  }
};

const speechToText = async (req, res, next) => {
  try {
    const { audio, language_code } = req.body;
    if (!audio) return res.status(400).json({ error: 'Audio data is required' });

    const audioBuffer = Buffer.from(audio, 'base64');
    const transcript = await sarvamService.speechToText(audioBuffer, language_code || 'hi-IN');
    
    res.json({ transcript });
  } catch (err) {
    console.error('Sarvam STT Controller Error:', err.message);
    res.status(500).json({ error: 'Sarvam STT processing failed' });
  }
};

module.exports = { textToSpeech, speechToText };
