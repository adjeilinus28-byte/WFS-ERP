// Emails HSE incident notifications to: head of HSE, head of Operations, and
// the head of the department where it occurred. POST { org_id, incident_id }
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, incident_id } = JSON.parse(event.body || '{}')
    if (!org_id || !incident_id) return { statusCode: 400, body: JSON.stringify({ error: 'org_id and incident_id required' }) }
    const sb = admin()
    const { data: org } = await sb.from('organizations').select('name, accent_color, hse_head_email, ops_head_email').eq('id', org_id).single()
    const { data: inc } = await sb.from('hse_incidents').select('*').eq('id', incident_id).single()
    if (!inc) return { statusCode: 404, body: JSON.stringify({ error: 'incident not found' }) }

    // Build recipient list: HSE head, Ops head, department head
    const recips = new Set()
    if (org?.hse_head_email) recips.add(org.hse_head_email)
    if (org?.ops_head_email) recips.add(org.ops_head_email)
    if (inc.department) {
      const { data: dept } = await sb.from('departments').select('head_email').eq('org_id', org_id).eq('name', inc.department).maybeSingle()
      if (dept?.head_email) recips.add(dept.head_email)
    }
    // Fallback so it never silently sends to nobody
    let to = [...recips]
    if (to.length === 0) to = await recipientsFor(sb, org_id, ['owner', 'admin', 'manager'])

    const sevColor = { critical: '#dc2626', high: '#ea580c', medium: '#F59E0B', low: '#16a34a' }[inc.severity] || '#F59E0B'
    const body = `
      <p>An HSE incident has been logged and requires your attention.</p>
      <table style="width:100%;font-size:14px;margin:10px 0;border-collapse:collapse">
        <tr><td style="color:#6b7280;padding:5px 0">Reference</td><td style="text-align:right;font-weight:bold">${inc.incident_no || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Type</td><td style="text-align:right">${inc.incident_type || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Severity</td><td style="text-align:right"><span style="background:${sevColor}22;color:${sevColor};padding:2px 10px;border-radius:20px;font-weight:bold">${(inc.severity || '').toUpperCase()}</span></td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Location</td><td style="text-align:right">${inc.location || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Department</td><td style="text-align:right">${inc.department || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Occurred</td><td style="text-align:right">${inc.occurred_at || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0">Reported by</td><td style="text-align:right">${inc.reported_by || '—'}</td></tr>
      </table>
      <p><b>Description</b><br/>${inc.description || '—'}</p>
      ${inc.corrective_action ? `<p><b>Corrective action</b><br/>${inc.corrective_action}</p>` : ''}
      <p style="margin-top:14px">Please review this incident in the HSE &amp; Safety module and coordinate any follow-up.</p>`

    const ok = await sendBrevo({ to, subject: `[${org.name}] HSE Incident ${inc.incident_no || ''} — ${(inc.severity || '').toUpperCase()} (${inc.department || 'site'})`, html: shell(org.name, org.accent_color, 'HSE Incident Alert', body) })
    await sb.from('hse_incidents').update({ notified: true }).eq('id', incident_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'hse_incident', subject: `Incident ${inc.incident_no || ''}`, recipients: to, status: ok ? 'sent' : 'failed' })
    return { statusCode: 200, body: JSON.stringify({ ok, recipients: to.length }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
