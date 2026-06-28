// Polyfill WebSocket for Node.js < 22 — required by @supabase/supabase-js
// realtime client. Without this, Netlify functions (Node 20) throw on client init.
if (!globalThis.WebSocket) {
  try { globalThis.WebSocket = require('ws') } catch (_) {}
}

const { createClient } = require('@supabase/supabase-js')

function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

async function sendBrevo({ to, subject, html }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map((email) => ({ email }))
  if (recipients.length === 0) return false
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'WFS Enterprise' },
      to: recipients, subject, htmlContent: html,
    }),
  })
  if (!res.ok) console.error('[Brevo]', res.status, await res.text())
  return res.ok
}

function shell(orgName, accent, title, bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:#080C16;padding:20px 24px">
      <div style="color:#F1F5F9;font-size:18px;font-weight:800">${orgName}</div>
      <div style="color:${accent || '#F59E0B'};font-size:11px;letter-spacing:2px;text-transform:uppercase">WFS Enterprise · ${title}</div>
    </div>
    <div style="padding:24px;color:#111827;font-size:14px;line-height:1.6">${bodyHtml}</div>
    <div style="padding:14px 24px;background:#f8fafc;color:#64748B;font-size:11px">Powered by WorkFlow Solutions · workflow-app.net</div>
  </div>`
}

async function recipientsFor(sb, orgId, roles = ['owner', 'admin', 'manager']) {
  const { data } = await sb.from('org_members').select('email, role').eq('org_id', orgId).in('role', roles)
  return (data || []).map((m) => m.email).filter(Boolean)
}

module.exports = { admin, sendBrevo, shell, recipientsFor }
