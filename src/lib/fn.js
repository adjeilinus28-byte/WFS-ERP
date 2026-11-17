import { supabase } from './supabase'

// Calls a Netlify function as the signed-in user: POSTs `payload` as JSON and
// sends the session token, so the function can check who is calling and which
// workspace they belong to. Returns the fetch Response.
export async function callFn(name, payload) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload ?? {}),
  })
}
