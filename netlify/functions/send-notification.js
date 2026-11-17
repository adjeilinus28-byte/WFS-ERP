// On-demand notification endpoint. POST { org_id, alert_type, subject, body, roles? }
// Caller must be signed in as an owner or admin of org_id. Recipients are that
// workspace's members with the given roles. `body` is plain text: it is
// HTML-escaped and line breaks are kept.
const { admin, sendBrevo, shell, recipientsFor, esc, json, requireMember } = require('./_lib')

const ROLES = ['owner', 'admin', 'manager', 'supervisor', 'operator', 'viewer']

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, alert_type, subject, body, roles } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb, roles: ['owner', 'admin'] })
    if (auth.error) return auth.error
    if (!subject) return json(400, { error: 'org_id and subject required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const wanted = Array.isArray(roles) ? roles.filter((r) => ROLES.includes(r)) : undefined
    const to = await recipientsFor(sb, org_id, wanted && wanted.length ? wanted : undefined)
    const html = shell(org, org.accent_color, alert_type || 'Notification', `<p>${esc(body || '').replace(/\r?\n/g, '<br/>')}</p>`)
    const ok = await sendBrevo({ to, subject, html })
    await sb.from('notification_log').insert({ org_id, alert_type: alert_type || 'manual', subject, recipients: to, status: ok ? 'sent' : 'failed' })
    return json(200, { ok, recipients: to.length })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
