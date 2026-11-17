// Industrial Relations event notifications via Brevo.
// POST { org_id, concern_id, event }
//   event: submitted | urgent | referred | engagement
// Caller must be signed in and a member of org_id; the concern is only looked
// up inside that workspace, and everything typed is HTML-escaped. Each event
// must match the concern's own state or nothing is sent (409):
//   submitted / urgent  only for a concern still 'new' and created in the last
//                       15 minutes; urgent-or-not comes from its stored severity
//   referred            only when the concern is marked referred_to_counsellor
//   engagement          only when a counsellor posted on it in the last 15 minutes
const { admin, sendBrevo, shell, esc, json, isRecent, requireMember } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, concern_id, event: requested } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb })
    if (auth.error) return auth.error
    if (!concern_id || !requested) return json(400, { error: 'org_id, concern_id, event required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color, iro_email, counsellor_email, wellbeing_note').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: c } = await sb.from('ir_concerns').select('*').eq('id', concern_id).eq('org_id', org_id).maybeSingle()
    if (!c) return json(404, { error: 'concern not found' })

    let kind = requested
    if (requested === 'submitted' || requested === 'urgent') {
      if (!(c.status === 'new' && isRecent(c.created_at))) return json(409, { error: 'concern is not new' })
      kind = ['urgent', 'high'].includes(c.severity) ? 'urgent' : 'submitted'
    } else if (requested === 'referred') {
      if (!c.referred_to_counsellor) return json(409, { error: 'concern has not been referred' })
    } else if (requested === 'engagement') {
      const { data: eng } = await sb.from('ir_engagements').select('created_at')
        .eq('org_id', org_id).eq('concern_id', concern_id).eq('author_role', 'counsellor')
        .order('created_at', { ascending: false }).limit(1)
      if (!eng || !eng[0] || !isRecent(eng[0].created_at)) return json(409, { error: 'no recent counsellor message' })
    } else {
      return json(400, { error: 'unknown event' })
    }

    let to = [], subject = '', body = ''
    const caseRef = `<b>${esc(c.case_id)}</b>`
    const wellbeing = org.wellbeing_note ? `<p style="color:#6b7280;font-size:13px">${esc(org.wellbeing_note)}</p>` : ''

    if (kind === 'submitted' || kind === 'urgent') {
      // Notify IRO. Urgent = immediate (don't wait for weekly).
      if (org.iro_email) to = [org.iro_email]
      subject = `[${org.name}] ${kind === 'urgent' ? 'URGENT ' : ''}New concern logged: ${c.case_id}`
      body = `<p>A new concern has been logged in the drop box${kind === 'urgent' ? ' and flagged <b>urgent</b>' : ''}.</p>
        <p>Case: ${caseRef}<br/>Subject: ${esc(c.subject)}<br/>Type: ${c.anonymous ? 'Anonymous' : esc(c.employee_name || 'Identified')}<br/>Department: ${esc(c.department || '—')}</p>
        <p>Review and classify it in the Industrial Relations module.</p>`
      // Also acknowledge the worker if they left a contact email
      if (c.contact_email) {
        await sendBrevo({ to: [c.contact_email], subject: `[${org.name}] Your concern was received — ${c.case_id}`,
          html: shell(org, org.accent_color, 'Concern Received',
            `<p>Thank you for speaking up. Your concern has been received and will be handled confidentially.</p>
             <p>Your case reference is ${caseRef}. Keep it (with your access code) to check status or reply.</p>
             ${wellbeing}`) })
      }
    } else if (kind === 'referred') {
      if (org.counsellor_email) to = [org.counsellor_email]
      subject = `[${org.name}] Case referred to you: ${c.case_id}`
      const identity = (c.anonymous && !c.consent_reveal) ? 'Anonymous (identity withheld unless the worker consents)' : (c.employee_name || 'Identified')
      body = `<p>A case has been referred to you for support.</p>
        <p>Case: ${caseRef}<br/>Category: ${esc(c.category || 'unclassified')}<br/>Worker: ${esc(identity)}</p>
        <p>Open the Counsellor view to engage confidentially. Please handle with care and discretion.</p>`
    } else if (kind === 'engagement') {
      // Counsellor reached out — notify the worker (only if we have a contact channel)
      const email = c.contact_email
      if (!email) return json(200, { ok: false, note: 'no worker contact channel' })
      to = [email]
      subject = `[${org.name}] A message about your case ${c.case_id}`
      body = `<p>Hello,</p><p>There is an update from the counsellor regarding your case ${caseRef}.</p>
        <p>Log in and use your case reference and access code to read and reply — your privacy is protected.</p>
        ${wellbeing}`
    } else {
      return json(400, { error: 'unknown event' })
    }

    if (to.length === 0) return json(200, { ok: false, note: 'no recipient configured' })
    const ok = await sendBrevo({ to, subject, html: shell(org, org.accent_color, 'Industrial Relations', body) })
    await sb.from('notification_log').insert({ org_id, alert_type: `ir_${kind}`, subject, recipients: to, status: ok ? 'sent' : 'failed' })
    return json(200, { ok })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
