// Industrial Relations event notifications via Brevo.
// POST { org_id, concern_id, event }
//   event: submitted | urgent | referred | engagement
const { admin, sendBrevo, shell } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, concern_id, event: kind } = JSON.parse(event.body || '{}')
    if (!org_id || !concern_id || !kind) return { statusCode: 400, body: JSON.stringify({ error: 'org_id, concern_id, event required' }) }
    const sb = admin()
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color, iro_email, counsellor_email, wellbeing_note').eq('id', org_id).single()
    const { data: c } = await sb.from('ir_concerns').select('*').eq('id', concern_id).single()
    if (!c) return { statusCode: 404, body: JSON.stringify({ error: 'concern not found' }) }

    let to = [], subject = '', body = ''
    const caseRef = `<b>${c.case_id}</b>`

    if (kind === 'submitted' || kind === 'urgent') {
      // Notify IRO. Urgent = immediate (don't wait for weekly).
      if (org.iro_email) to = [org.iro_email]
      subject = `[${org.name}] ${kind === 'urgent' ? 'URGENT ' : ''}New concern logged: ${c.case_id}`
      body = `<p>A new concern has been logged in the drop box${kind === 'urgent' ? ' and flagged <b>urgent</b>' : ''}.</p>
        <p>Case: ${caseRef}<br/>Subject: ${c.subject}<br/>Type: ${c.anonymous ? 'Anonymous' : (c.employee_name || 'Identified')}<br/>Department: ${c.department || '—'}</p>
        <p>Review and classify it in the Industrial Relations module.</p>`
      // Also acknowledge the worker if they left a contact email
      if (c.contact_email) {
        await sendBrevo({ to: [c.contact_email], subject: `[${org.name}] Your concern was received — ${c.case_id}`,
          html: shell(org, org.accent_color, 'Concern Received',
            `<p>Thank you for speaking up. Your concern has been received and will be handled confidentially.</p>
             <p>Your case reference is ${caseRef}. Keep it (with your access code) to check status or reply.</p>
             ${org.wellbeing_note ? `<p style="color:#6b7280;font-size:13px">${org.wellbeing_note}</p>` : ''}`) })
      }
    } else if (kind === 'referred') {
      if (org.counsellor_email) to = [org.counsellor_email]
      subject = `[${org.name}] Case referred to you: ${c.case_id}`
      const identity = (c.anonymous && !c.consent_reveal) ? 'Anonymous (identity withheld unless the worker consents)' : (c.employee_name || 'Identified')
      body = `<p>A case has been referred to you for support.</p>
        <p>Case: ${caseRef}<br/>Category: ${c.category || 'unclassified'}<br/>Worker: ${identity}</p>
        <p>Open the Counsellor view to engage confidentially. Please handle with care and discretion.</p>`
    } else if (kind === 'engagement') {
      // Counsellor reached out — notify the worker (only if we have a contact channel)
      const email = c.contact_email
      if (!email) return { statusCode: 200, body: JSON.stringify({ ok: false, note: 'no worker contact channel' }) }
      to = [email]
      subject = `[${org.name}] A message about your case ${c.case_id}`
      body = `<p>Hello,</p><p>There is an update from the counsellor regarding your case ${caseRef}.</p>
        <p>Log in and use your case reference and access code to read and reply — your privacy is protected.</p>
        ${org.wellbeing_note ? `<p style="color:#6b7280;font-size:13px">${org.wellbeing_note}</p>` : ''}`
    }

    if (to.length === 0) return { statusCode: 200, body: JSON.stringify({ ok: false, note: 'no recipient configured' }) }
    const ok = await sendBrevo({ to, subject, html: shell(org, org.accent_color, 'Industrial Relations', body) })
    await sb.from('notification_log').insert({ org_id, alert_type: `ir_${kind}`, subject, recipients: to, status: ok ? 'sent' : 'failed' })
    return { statusCode: 200, body: JSON.stringify({ ok }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
