const supabase = require('./supabase')

// Create sources table if it doesn't exist
const initSourcesTable = async function() {
  const { error } = await supabase.rpc('create_sources_table_if_not_exists')
  if (error && !error.message.includes('already exists')) {
    console.error('Error creating sources table:', error.message)
  }
}

module.exports = { initSourcesTable }