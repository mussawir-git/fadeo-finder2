const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[supabaseClient] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env. ' +
    'Copy .env.example to .env and fill in your Supabase project credentials.'
  );
  process.exit(1);
}

// IMPORTANT: this uses the SERVICE ROLE key, which bypasses Row Level Security.
// This client must only ever be used on the server, never sent to the frontend.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = supabase;
