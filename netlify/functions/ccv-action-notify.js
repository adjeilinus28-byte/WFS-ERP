// Fires when a CCV with an assigned action is logged — emails the responsible
// person to close it out. POST { org_id, interaction_id }
const { admin, sendBrevo, shell } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, interaction_id } = JSON.parse(event.body || '{}')
    if (!org_id || !interaction_id) return { statusCode: 400, body: JSON.stringify({ error: 'org_id and interaction_id required' }) }
    const sb = admin()
    const { data: org } = await sb.from('organizations').select('name, accent_color').eq('id', org_id).single()
    const { data: s } = await sb.from('safety_interactions').select('*').eq('id', interaction_id).single()
    if (!s) return { statusCode: 404, body: JSON.stringify({ error: 'record not found' }) }
    if (!s.assigned_to_email) return { statusCode: 200, body: JSON.stringify({ ok: false, note: 'no assignee email' }) }

    const body = `
      <p>Dear ${s.assigned_to_name || 'Colleague'},</p>
      <p>A Critical Control Verification (<b>${s.ref_no || s.form_type.toUpperCase()}</b>) has raised an action assigned to you for close-out.</p>
      <table style="width:100%;font-size:14px;margin:10px 0">
        <tr><td style="color:#6b7280;padding:4px 0">Critical control</td><td style="text-align:right">${s.critical_control || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0">Location</td><td style="text-align:right">${s.location || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0">Observed by</td><td style="text-align:right">${s.observer_name || '—'}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0">Due</td><td style="text-align:right">${s.action_due || 'ASAP'}</td></tr>
      </table>
      <p><b>Action required:</b><br/>${s.action_description || '—'}</p>
      <p style="margin-top:14px">Please complete and close this action in the HSE → Safety Interactions module before the due date.</p>`
    const ok = await sendBrevo({ to: [s.assigned_to_email], subject: `[${org.name}] CCV action assigned to you — close-out required`, html: shell(org.name, org.accent_color, 'Critical Control Verification', body) })
    await sb.from('safety_interactions').update({ notified: true }).eq('id', interaction_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'ccv_action', subject: `CCV action ${s.ref_no || ''}`, recipients: [s.assigned_to_email], status: ok ? 'sent' : 'failed' })
    return { statusCode: 200, body: JSON.stringify({ ok }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
