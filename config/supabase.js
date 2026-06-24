const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL      = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    'Supabase config warning: SUPABASE_URL or SUPABASE_ANON_KEY is not set in .env. ' +
    'Supabase client will not be functional until these are provided.'
  )
}

const supabase = createClient(
  SUPABASE_URL      || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key'
)

module.exports = supabase
