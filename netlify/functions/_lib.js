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
// A workspace colour is only used if it is a plain hex colour (#abc / #aabbcc).
const safeColor = (c, fallback = '#F59E0B') => { const s = String(c || '').trim(); return /^#[0-9a-f]{3,8}$/i.test(s) ? s : fallback }
// A typed link is only used if it is a web address. "www.x.com" gets https://;
// anything with another scheme (javascript:, data:, …) is dropped. Escaped for
// use inside href="…".
const safeUrl = (u) => {
  const s = String(u || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return esc(s)
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return ''
  return esc('https://' + s)
}
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
// True when a database timestamp (e.g. created_at default now()) is within the
// last `mins` minutes. Used so "new record" emails can't be replayed later.
const isRecent = (ts, mins = 15) => {
  const t = ts ? new Date(ts).getTime() : NaN
  return Number.isFinite(t) && Date.now() - t < mins * 60000 && t - Date.now() < 5 * 60000
}

// ── Who is calling? ─────────────────────────────────────────────────────────
// Every function a signed-in user triggers starts with this. It reads the
// `Authorization: Bearer <jwt>` header, checks the session with Supabase, and
// checks the caller is a member of orgId. Options:
//   roles: ['owner', 'admin']          member's role must be one of these
//   perms: [['finance', 'edit'], …]    caller needs at least ONE of these domain
//                                      levels, worked out by the database's own
//                                      permission_level() (same rules as the app)
//   sb:    an admin() client to reuse
// Returns { user, member } when allowed, otherwise { error } holding a ready
// 401 / 403 / 400 response for the handler to return.
const RANK = { none: 0, view: 1, edit: 2, manage: 3 }
async function requireMember(event, orgId, { roles, perms, sb } = {}) {
  const h = (event && event.headers) || {}
  const jwt = String(h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { error: json(401, { error: 'Not signed in' }) }
  sb = sb || admin()
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data && data.user
  if (error || !user) return { error: json(401, { error: 'Your session has expired. Sign in again.' }) }
  if (!orgId) return { error: json(400, { error: 'org_id required' }) }
  const { data: member } = await sb.from('org_members').select('role, email')
    .eq('org_id', orgId).eq('user_id', user.id).maybeSingle()
  if (!member) return { error: json(403, { error: 'You are not a member of this workspace' }) }
  if (roles && !roles.includes(member.role)) return { error: json(403, { error: 'Your role cannot do this' }) }
  if (perms && perms.length) {
    let allowed = false
    for (const [domain, min] of perms) {
      const { data: level, error: pErr } = await sb.rpc('permission_level', { p_org: orgId, p_user: user.id, p_domain: domain })
      if (!pErr && (RANK[level] ?? 0) >= (RANK[min] ?? Infinity)) { allowed = true; break }
    }
    if (!allowed) return { error: json(403, { error: 'You do not have permission to do this' }) }
  }
  return { user, member }
}

// May this member decide (approve/decline) an item of `type` ('leave',
// 'purchase_request', 'overtime')? Same rule as the database's check_approval():
// the member's role must rank at or above the workspace's approver role for that
// type (approval_rule(), default manager), using the database's role_rank().
async function canDecide(sb, orgId, member, type) {
  const { data: rule, error } = await sb.rpc('approval_rule', { p_org: orgId, p_type: type })
  const approverRole = (Array.isArray(rule) ? rule[0] : rule)?.approver_role
  if (error || !approverRole) return false
  const [{ data: mine }, { data: needed }] = await Promise.all([
    sb.rpc('role_rank', { p_role: member.role }),
    sb.rpc('role_rank', { p_role: approverRole }),
  ])
  return Number.isFinite(mine) && Number.isFinite(needed) && mine >= needed
}

const shortHash =(str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }

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
          <div style="color:${safeColor(accent)};font-size:11px;letter-spacing:2px;text-transform:uppercase">WFS Enterprise · ${esc(title)}</div>
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

module.exports = { admin, sendBrevo, shell, recipientsFor, esc, safeColor, safeUrl, json, isRecent, requireMember, canDecide }
