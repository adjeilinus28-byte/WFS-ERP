// On-demand notification endpoint. POST { org_id, alert_type, subject, body, roles? }
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, alert_type, subject, body, roles } = JSON.parse(event.body || '{}')
    if (!org_id || !subject) return { statusCode: 400, body: JSON.stringify({ error: 'org_id and subject required' }) }
    const sb = admin()
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).single()
    const to = await recipientsFor(sb, org_id, roles)
    const ok = await sendBrevo({ to, subject, html: shell(org || 'Workspace', org?.accent_color, alert_type || 'Notification', body || '') })
    await sb.from('notification_log').insert({ org_id, alert_type: alert_type || 'manual', subject, recipients: to, status: ok ? 'sent' : 'failed' })
    return { statusCode: 200, body: JSON.stringify({ ok, recipients: to.length }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
