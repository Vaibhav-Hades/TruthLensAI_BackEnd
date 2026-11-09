const { createClient } = require('@supabase/supabase-js')

/**
 * Supabase client.
 *
 * Env:
 *   SUPABASE_URL                 (required)
 *   SUPABASE_SERVICE_ROLE_KEY    (recommended for this backend)
 *   SUPABASE_ANON_KEY            (fallback)
 *
 * Why the service-role key: this backend does its own authentication (bcrypt + JWT) and
 * does NOT use Supabase Auth, so `auth.uid()` is always null for its requests. With the anon
 * key and the Row Level Security policies in setup-supabase.sql, inserts/updates on `users`,
 * `reports` and `flags` are rejected. The service-role key bypasses RLS and must stay
 * server-side only (never put it in the frontend or commit it).
 */
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY
const KEY = SERVICE_KEY || ANON_KEY

const isConfigured = Boolean(SUPABASE_URL && KEY)

if (!isConfigured) {
  console.warn(
    '[supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are not set. ' +
    'Database-backed routes (auth, reports, flags, admin stats) will answer 503 until they are provided.'
  )
} else if (!SERVICE_KEY) {
  console.warn(
    '[supabase] Using SUPABASE_ANON_KEY. If Row Level Security is enabled, sign-up/report/flag writes will be ' +
    'rejected. Set SUPABASE_SERVICE_ROLE_KEY (server-side only) or disable RLS on those tables.'
  )
}

const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  KEY || 'placeholder-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

supabase.isConfigured = isConfigured
supabase.usingServiceRole = Boolean(SERVICE_KEY)

module.exports = supabase
