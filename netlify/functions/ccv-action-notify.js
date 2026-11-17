// Fires when a CCV with an assigned action is logged — emails the responsible
// person to close it out. POST { org_id, interaction_id }
// Caller must be signed in and a member of org_id; the record is only looked up
// inside that workspace, and everything typed is HTML-escaped.
const { admin, sendBrevo, shell, esc, json, requireMember } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, interaction_id } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb })
    if (auth.error) return auth.error
    if (!interaction_id) return json(400, { error: 'org_id and interaction_id required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: s } = await sb.from('safety_interactions').select('*').eq('id', interaction_id).eq('org_id', org_id).maybeSingle()
    if (!s) return json(404, { error: 'record not found' })
    if (!s.assigned_to_email) return json(200, { ok: false, note: 'no assignee email' })

    const body = `
      <p>Dear ${esc(s.assigned_to_name || 'Colleague')},</p>
      <p>A Critical Control Verification (<b>${esc(s.ref_no || String(s.form_type || 'ccv').toUpperCase())}</b>) has raised an action assigned to you for close-out.</p>
      <table style="width:100%;font-size:14px;margin:10px 0">
        <tr><td style="color:#6b7280;padding:4px 0">Critical control</td><td style="text-align:right">${esc(s.critical_control || '—')}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0">Location</td><td style="text-align:right">${esc(s.location || '—')}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0">Observed by</td><td style="text-align:right">${esc(s.observer_name || '—')}</td></tr>
        <tr><td style="color:#6b7280;padding:4px 0">Due</td><td style="text-align:right">${esc(s.action_due || 'ASAP')}</td></tr>
      </table>
      <p><b>Action required:</b><br/>${esc(s.action_description || '—')}</p>
      <p style="margin-top:14px">Please complete and close this action in the HSE → Safety Interactions module before the due date.</p>`
    const ok = await sendBrevo({ to: [s.assigned_to_email], subject: `[${org.name}] CCV action assigned to you — close-out required`, html: shell(org, org.accent_color, 'Critical Control Verification', body) })
    await sb.from('safety_interactions').update({ notified: true }).eq('id', interaction_id).eq('org_id', org_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'ccv_action', subject: `CCV action ${s.ref_no || ''}`, recipients: [s.assigned_to_email], status: ok ? 'sent' : 'failed' })
    return json(200, { ok })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
