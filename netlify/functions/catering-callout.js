// Callout meal notifications. POST { org_id, callout_id, event }
//   requested → email the worker's department head (fallback managers)
//   decided   → email the worker with the outcome
// Caller must be signed in and a member of org_id; the callout is only looked
// up inside that workspace, and everything typed is HTML-escaped.
const { admin, sendBrevo, shell, recipientsFor, esc, json, requireMember } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, callout_id, event: kind } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb })
    if (auth.error) return auth.error
    if (!callout_id || !kind) return json(400, { error: 'org_id, callout_id, event required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: r } = await sb.from('callout_requests').select('*').eq('id', callout_id).eq('org_id', org_id).maybeSingle()
    if (!r) return json(404, { error: 'callout not found' })
    const dayLabel = new Date(r.service_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

    let to = [], subject = '', body = ''
    if (kind === 'requested') {
      // Department head first, fallback to managers
      if (r.department) {
        const { data: dept } = await sb.from('departments').select('head_email').eq('org_id', org_id).eq('name', r.department).maybeSingle()
        if (dept?.head_email) to = [dept.head_email]
      }
      if (to.length === 0) to = await recipientsFor(sb, org_id, ['owner', 'admin', 'manager'])
      subject = `[${org.name}] Callout meal request — ${r.employee_name} (${dayLabel})`
      body = `<p><b>${esc(r.employee_name)}</b> (${esc(r.department || '—')}) is requesting meals for <b>${esc(dayLabel)}</b>, which is their off day.</p>
        ${r.reason ? `<p>Reason: ${esc(r.reason)}</p>` : ''}
        <p>Approve or decline it in Catering → Callout Approvals.</p>`
    } else if (kind === 'decided') {
      // Find the worker's email from the employee record
      const { data: emp } = await sb.from('employees').select('email').eq('id', r.employee_id).eq('org_id', org_id).maybeSingle()
      if (!emp?.email) return json(200, { ok: false, note: 'worker has no email' })
      to = [emp.email]
      const approved = r.status === 'approved'
      subject = `[${org.name}] Callout ${approved ? 'approved' : 'declined'} — ${dayLabel}`
      body = approved
        ? `<p>Your callout for <b>${esc(dayLabel)}</b> has been <b style="color:#16a34a">approved</b>. You can now place your meal orders for that day in the Catering module (subject to the 2-day ordering window).</p>`
        : `<p>Your callout request for <b>${esc(dayLabel)}</b> was <b style="color:#b91c1c">declined</b>. No meals will be prepared for you that day.</p>`
    } else {
      return json(400, { error: 'unknown event' })
    }

    if (to.length === 0) return json(200, { ok: false, note: 'no recipient' })
    const ok = await sendBrevo({ to, subject, html: shell(org, org.accent_color, 'Catering Callout', body) })
    await sb.from('notification_log').insert({ org_id, alert_type: `callout_${kind}`, subject, recipients: to, status: ok ? 'sent' : 'failed' })
    return json(200, { ok })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
