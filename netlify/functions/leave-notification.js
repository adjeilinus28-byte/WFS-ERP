// Brevo notification for leave events (submitted / approved / declined).
// POST { org_id, request_id, event }  event: submitted | approved | declined
// Caller must be signed in and a member of org_id; the request is only looked
// up inside that workspace, and everything typed is HTML-escaped.
const { admin, sendBrevo, shell, recipientsFor, esc, json, requireMember } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, request_id, event: kind } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb })
    if (auth.error) return auth.error
    if (!request_id) return json(400, { error: 'org_id and request_id required' })
    if (!['submitted', 'approved', 'declined'].includes(kind)) return json(400, { error: 'unknown event' })

    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color, contact_email').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: lr } = await sb.from('leave_requests').select('*').eq('id', request_id).eq('org_id', org_id).maybeSingle()
    if (!lr) return json(404, { error: 'request not found' })

    // Pull the employee's own email if linked
    let empEmail = null
    if (lr.employee_id) {
      const { data: emp } = await sb.from('employees').select('email').eq('id', lr.employee_id).eq('org_id', org_id).maybeSingle()
      empEmail = emp?.email || null
    }

    const period = esc(`${lr.start_date} → ${lr.end_date} (${lr.working_days || lr.days} day(s))`)
    let to, subject, body

    if (kind === 'submitted') {
      // Notify approvers (managers/admins)
      to = await recipientsFor(sb, org_id, ['owner', 'admin', 'manager'])
      subject = `[${org.name}] Leave request from ${lr.employee_name}`
      body = `<p><b>${esc(lr.employee_name)}</b> (${esc(lr.department || '—')}) has submitted a leave request awaiting approval.</p>
        <p><b>Type:</b> ${esc(lr.leave_type)}<br/><b>Period:</b> ${period}<br/><b>Reason:</b> ${esc(lr.reason || '—')}</p>
        <p>Review it in the HR → Leave module.</p>`
    } else {
      // Notify the applicant of the decision
      to = empEmail ? [empEmail] : await recipientsFor(sb, org_id, ['owner', 'admin'])
      const verb = kind === 'approved' ? 'approved' : 'declined'
      subject = `[${org.name}] Your leave request was ${verb}`
      body = `<p>Hi ${esc(lr.employee_name)},</p>
        <p>Your <b>${esc(lr.leave_type)}</b> leave request for <b>${period}</b> has been <b>${verb}</b>.</p>
        ${lr.decision_note ? `<p><b>Note:</b> ${esc(lr.decision_note)}</p>` : ''}
        ${kind === 'approved'
          ? '<p>Please ensure a proper handover before your leave begins.</p>'
          : '<p>Contact your manager or HR if you have questions.</p>'}`
    }

    const ok = await sendBrevo({ to, subject, html: shell(org, org.accent_color, 'Leave Notification', body) })
    await sb.from('leave_requests').update({ notified: true }).eq('id', request_id).eq('org_id', org_id)
    await sb.from('notification_log').insert({ org_id, alert_type: `leave_${kind}`, subject, recipients: to, status: ok ? 'sent' : 'failed' })

    return json(200, { ok, recipients: to.length })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
