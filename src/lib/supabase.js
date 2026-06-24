import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  // Surface misconfig early rather than failing cryptically on first query.
  console.warn('[WFS] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in Netlify env.')
}

// Singleton client. persistSession keeps the user signed in across reloads.
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
