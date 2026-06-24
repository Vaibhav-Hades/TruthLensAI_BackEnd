require('dotenv').config()
const supabase = require('./config/supabase')
const { generateEmbedding } = require('./services/embeddingService')

const sources = [
  { label: 'Reuters: Fact-check database',  url: 'https://reuters.com/fact-check' },
  { label: 'AP News: Verified reporting',    url: 'https://apnews.com' },
  { label: 'Snopes: Claim verification',     url: 'https://snopes.com' },
  { label: 'PolitiFact: Political claims',   url: 'https://politifact.com' },
  { label: 'FactCheck.org',                  url: 'https://factcheck.org' }
]

async function seed() {
  // Clear existing sources
  const { error: deleteError } = await supabase
    .from('sources')
    .delete()
    .neq('id', 0)

  if (deleteError) {
    console.error('Error clearing sources:', deleteError.message)
  }

  // Insert new sources with embeddings
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i]
    var embedding = await generateEmbedding(s.label + ' ' + s.url)
    
    const { error } = await supabase
      .from('sources')
      .insert({
        label: s.label,
        url: s.url,
        embedding: embedding,
        created_at: new Date().toISOString()
      })

    if (error) {
      console.error('Error seeding source:', s.label, error.message)
    } else {
      console.log('Seeded:', s.label)
    }
  }
  
  console.log('Done seeding.')
}

seed().catch(console.error)