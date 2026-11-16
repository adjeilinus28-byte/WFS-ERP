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

async function sendBrevo({ to, cc, subject, html, attachments }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map((email) => ({ email }))
  if (recipients.length === 0) return false
  // cc can be an array or a comma/semicolon separated string
  const ccList = (Array.isArray(cc) ? cc : String(cc || '').split(/[,;]/))
    .map((e) => (e || '').trim()).filter((e) => e && e.includes('@')).map((email) => ({ email }))
  const payload = {
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'WFS Enterprise' },
    to: recipients, subject, htmlContent: html,
  }
  if (ccList.length) payload.cc = ccList
  // attachments: [{ url, name }] — Brevo fetches the (public) URL
  const atts = (attachments || []).filter((a) => a && a.url).map((a) => ({ url: a.url, name: a.name || 'attachment' }))
  if (atts.length) payload.attachment = atts
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) console.error('[Brevo]', res.status, await res.text())
  return res.ok
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const shortHash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

// Branded email wrapper. First argument: the organization row (preferably with
// id + logo_url, so its logo shows in the header) or just its name.
function shell(orgOrName, accent, title, bodyHtml) {
  const org = orgOrName && typeof orgOrName === 'object' ? orgOrName : { name: orgOrName }
  const name = esc(org.name || 'WFS Enterprise')
  const base = (process.env.URL || '').replace(/\/$/, '')
  const logo = org.id && org.logo_url && base
    ? `<td style="padding-right:14px;vertical-align:middle"><img src="${base}/.netlify/functions/org-logo?org=${org.id}&v=${shortHash(org.logo_url)}" alt="${name}" height="44" style="display:block;height:44px;width:auto;max-width:176px;background:#ffffff;border-radius:8px;padding:4px 6px" /></td>`
    : ''
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:#080C16;padding:18px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${logo}
        <td style="vertical-align:middle">
          <div style="color:#F1F5F9;font-size:18px;font-weight:800">${name}</div>
          <div style="color:${accent || '#F59E0B'};font-size:11px;letter-spacing:2px;text-transform:uppercase">WFS Enterprise · ${esc(title)}</div>
        </td></tr></table>
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
