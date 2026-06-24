const axios = require('axios');
const FormData = require('form-data');

/**
 * Sarvam AI Service - Optimized for Indian Languages
 * Provides STT, TTS, and Multilingual Intelligence.
 */
class SarvamService {
  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY;
    this.baseUrl = 'https://api.sarvam.ai';
  }

  /**
   * Speech to Text (STT) - Indian Languages
   * @param {Buffer} audioBuffer 
   * @param {string} languageCode - e.g. 'hi-IN', 'te-IN', 'ta-IN'
   */
  async speechToText(audioBuffer, languageCode = 'hi-IN') {
    if (!this.apiKey) throw new Error('SARVAM_API_KEY not configured');

    try {
      const form = new FormData();
      form.append('file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
      form.append('language_code', languageCode);
      form.append('model', 'saarathi');

      const response = await axios.post(`${this.baseUrl}/speech-to-text`, form, {
        headers: {
          'api-subscription-key': this.apiKey,
          ...form.getHeaders()
        }
      });

      return response.data.transcript;
    } catch (err) {
      console.error('Sarvam STT Failed:', err.response?.data || err.message);
      throw err;
    }
  }

  /**
   * Text to Speech (TTS) - Indian Languages
   * @param {string} text 
   * @param {string} languageCode 
   */
  async textToSpeech(text, languageCode = 'hi-IN') {
    if (!this.apiKey) throw new Error('SARVAM_API_KEY not configured');

    try {
      const response = await axios.post(`${this.baseUrl}/text-to-speech`, {
        inputs: [text],
        target_language_code: languageCode,
        speaker: 'meera', // standard Sarvam voice
        pitch: 0,
        pace: 1.0
      }, {
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data.audios[0]; // base64 encoded audio
    } catch (err) {
      console.error('Sarvam TTS Failed:', err.response?.data || err.message);
      throw err;
    }
  }

  /**
   * Translate - Indic languages
   */
  async translate(text, sourceLang, targetLang) {
    if (!this.apiKey) throw new Error('SARVAM_API_KEY not configured');

    try {
      const response = await axios.post(`${this.baseUrl}/translate`, {
        input: text,
        source_language_code: sourceLang,
        target_language_code: targetLang,
        speaker: 'meera'
      }, {
        headers: {
          'api-subscription-key': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data.translated_text;
    } catch (err) {
      console.error('Sarvam Translation Failed:', err.response?.data || err.message);
      throw err;
    }
  }
}

module.exports = new SarvamService();
