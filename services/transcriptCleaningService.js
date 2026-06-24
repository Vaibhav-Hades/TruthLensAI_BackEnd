/**
 * transcriptCleaningService.js
 * 
 * PHASE 1 V3: Production-Grade Linguistic Cleaning & Narrative Preservation
 * Removes noise while preserving factual integrity and flow.
 */

function cleanTranscript(text) {
  if (!text) return '';

  // 1. Basic Normalization & Whitespace Cleanup
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')

  // 2. Remove Timestamps, Speaker IDs, and Meta-Tags
  // Handles [00:12], (12:34), Speaker 1:, SPEAKER:, [Applause], etc.
  cleaned = cleaned
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\)/g, '')
    .replace(/^\d{1,2}:\d{2}\s+/gm, '')
    .replace(/^[A-Z][a-z]+ \d+:/gm, '')
    .replace(/^[A-Z\s]+:/gm, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\([^)]+\)/g, '')

  // 3. Multilingual Filler Noise & Verbal Tics Reduction
  // Targeted removal of conversational padding that doesn't add investigative value.
  const fillers = [
    // English
    'um+', 'uh+', 'ah+', 'err+', 'mmm+', 'hmm+', 'uh-huh', 'basically', 'actually', 
    'literally', 'you know', 'sort of', 'kind of', 'anyway', 'so then', 'like', 'alright',
    'you see', 'I mean', 'to be honest', 'frankly', 'basically',
    // Hindi/Hinglish
    'matlab', 'yaani', 'achha', 'varna', 'theek hai', 'dekhiye', 'suniye', 'samajhiye',
    'bilkul', 'shayad', 'kahin na kahin', 'ek tarah se', 'aap samajh rahe hain',
    // Telugu
    'ante', 'mari', 'ippudu', 'entante', 'vachhi', 'asalu', 'ade',
    // Tamil
    'appadi', 'vandhu', 'enna', 'theriyuma', 'irukku', 'saringa',
    // Generic
    'okay', 'right', 'yeah'
  ]
  const fillerRegex = new RegExp(`\\b(${fillers.join('|')})\\b`, 'gi')
  cleaned = cleaned.replace(fillerRegex, '')

  // 4. Semantic Deduplication & Sequence Cleaning
  // Auto-captions often repeat words or phrases ("The candidate candidate said...")
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1') // Simple word doubling
  
  // Sentence-level deduplication
  const sentences = cleaned.split(/[.!?]\s+|\n/)
  const uniqueSentences = []
  
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim()
    if (!s || s.length < 2) continue
    
    // Check if this sentence is a near-duplicate of recent context
    // Auto-transcripts often loop or stutter.
    const isRecentRepeat = uniqueSentences.slice(-4).some(prev => {
      const p = prev.toLowerCase().replace(/[^\w]/g, '')
      const curr = s.toLowerCase().replace(/[^\w]/g, '')
      
      // Jaccard-like similarity check for high-overlap stutters
      if (p === curr) return true
      if (curr.length > 10 && p.includes(curr)) return true
      if (p.length > 10 && curr.includes(p)) return true
      return false
    })
    
    if (!isRecentRepeat) uniqueSentences.push(s)
  }

  cleaned = uniqueSentences.join('. ')

  // 5. Narrative Integrity Check & Final Polish
  cleaned = cleaned
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim()

  // Safety Guard: If we lost >90% of a substantial transcript, fallback to basic cleanup
  // to ensure we don't accidentally wipe out non-standard language content.
  if (text.length > 500 && cleaned.length < text.length * 0.15) {
    return text.replace(/\[\d+:\d+\]/g, '').replace(/\s+/g, ' ').trim()
  }

  return cleaned
}

module.exports = { cleanTranscript }
