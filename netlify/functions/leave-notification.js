// Brevo notification for leave events (submitted / approved / declined).
// POST { org_id, request_id, event }  event: submitted | approved | declined
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, request_id, event: kind } = JSON.parse(event.body || '{}')
    if (!org_id || !request_id) return { statusCode: 400, body: JSON.stringify({ error: 'org_id and request_id required' }) }

    const sb = admin()
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color, contact_email').eq('id', org_id).single()
    const { data: lr } = await sb.from('leave_requests').select('*').eq('id', request_id).single()
    if (!lr) return { statusCode: 404, body: JSON.stringify({ error: 'request not found' }) }

    // Pull the employee's own email if linked
    let empEmail = null
    if (lr.employee_id) {
      const { data: emp } = await sb.from('employees').select('email').eq('id', lr.employee_id).single()
      empEmail = emp?.email || null
    }

    const period = `${lr.start_date} → ${lr.end_date} (${lr.working_days || lr.days} day(s))`
    let to, subject, body

    if (kind === 'submitted') {
      // Notify approvers (managers/admins)
      to = await recipientsFor(sb, org_id, ['owner', 'admin', 'manager'])
      subject = `[${org.name}] Leave request from ${lr.employee_name}`
      body = `<p><b>${lr.employee_name}</b> (${lr.department || '—'}) has submitted a leave request awaiting approval.</p>
        <p><b>Type:</b> ${lr.leave_type}<br/><b>Period:</b> ${period}<br/><b>Reason:</b> ${lr.reason || '—'}</p>
        <p>Review it in the HR → Leave module.</p>`
    } else {
      // Notify the applicant of the decision
      to = empEmail ? [empEmail] : await recipientsFor(sb, org_id, ['owner', 'admin'])
      const verb = kind === 'approved' ? 'approved' : 'declined'
      subject = `[${org.name}] Your leave request was ${verb}`
      body = `<p>Hi ${lr.employee_name},</p>
        <p>Your <b>${lr.leave_type}</b> leave request for <b>${period}</b> has been <b>${verb}</b>.</p>
        ${lr.decision_note ? `<p><b>Note:</b> ${lr.decision_note}</p>` : ''}
        ${kind === 'approved'
          ? '<p>Please ensure a proper handover before your leave begins.</p>'
          : '<p>Contact your manager or HR if you have questions.</p>'}`
    }

    const ok = await sendBrevo({ to, subject, html: shell(org, org.accent_color, 'Leave Notification', body) })
    await sb.from('leave_requests').update({ notified: true }).eq('id', request_id)
    await sb.from('notification_log').insert({ org_id, alert_type: `leave_${kind}`, subject, recipients: to, status: ok ? 'sent' : 'failed' })

    return { statusCode: 200, body: JSON.stringify({ ok, recipients: to.length }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
