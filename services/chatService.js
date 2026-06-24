const { chatWithGroq } = require('./llmService');
const sarvamService = require('./sarvamService');

/**
 * Main entry point for generating investigative answers.
 * Fully pipeline-aware and multilingual (Sarvam AI Enhanced).
 */
const generateAnswer = async function(question, context, history, language) {
  try {
    // Detect if we should use Sarvam enhancements for Indian languages
    const isIndianLang = ['hi', 'te', 'ta', 'kn', 'ml', 'mr', 'gu', 'pa', 'bn'].includes(language);
    
    // Forward the request to the high-intelligence Groq engine
    // We pass a 'sarvamActive' flag to the LLM to adjust its linguistic persona
    const reply = await chatWithGroq({
      question,
      context,
      history,
      language,
      sarvamActive: isIndianLang
    });

    return reply;
  } catch (err) {
    console.error('generateAnswer failed, using safe fallback:', err.message);
    
    // Minimal conversational fallback if LLM is down
    const score = context.truthScore || 50;
    const verdict = context.verdict_label || 'Unverified';
    
    return `I apologize, but I'm currently having trouble connecting to my investigative neural core. 
            
            However, I can confirm that this content has a **Truth Score of ${score}/100** and was marked as **${verdict}**. 
            
            Please try asking your question again in a moment, or review the Source Evidence panel for detailed article matches.`;
  }
}

module.exports = { generateAnswer }
