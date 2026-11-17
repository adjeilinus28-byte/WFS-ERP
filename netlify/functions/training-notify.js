// Announces a training session: sends ONE news-flash-style email to the target
// audience and creates a News Flash banner (with notify_target=null so the news
// system doesn't re-email). POST { org_id, session_id }
// Caller must be signed in with compliance edit rights in org_id (the same rule
// the database applies to training sessions); the session and its attendees are
// only looked up inside that workspace, and everything typed is HTML-escaped.
const { admin, sendBrevo, shell, esc, safeColor, safeUrl, json, requireMember } = require('./_lib')

const TYPE_LABEL = {
  induction: 'Induction', toolbox_talk: 'Toolbox Talk', refresher: 'Refresher',
  competency: 'Competency', first_aid: 'First Aid', fire_safety: 'Fire Safety',
  working_at_heights: 'Working at Heights', confined_space: 'Confined Space', other: 'Training',
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, session_id } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb, perms: [['compliance', 'edit']] })
    if (auth.error) return auth.error
    if (!session_id) return json(400, { error: 'org_id and session_id required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: s } = await sb.from('training_sessions').select('*').eq('id', session_id).eq('org_id', org_id).maybeSingle()
    if (!s) return json(404, { error: 'session not found' })

    // Resolve recipients from the assigned attendees (with emails)
    const { data: atts } = await sb.from('training_attendees').select('employee_id').eq('session_id', session_id).eq('org_id', org_id)
    const ids = (atts || []).map((a) => a.employee_id).filter(Boolean)
    let emails = []
    if (ids.length) {
      const { data: emps } = await sb.from('employees').select('email').eq('org_id', org_id).in('id', ids).not('email', 'is', null)
      emails = [...new Set((emps || []).map((e) => e.email).filter(Boolean))]
    }

    const typeLabel = TYPE_LABEL[s.training_type] || 'Training'
    const when = s.scheduled_at ? new Date(s.scheduled_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'To be confirmed'
    const scope = s.audience === 'all' ? 'All staff' : s.audience === 'department' ? `${s.department} department` : 'Selected staff'
    const accent = safeColor(org.accent_color)
    const joinUrl = safeUrl(s.link_url)
    const bodyHtml = `
      <p style="margin:0 0 4px"><span style="display:inline-block;background:${accent}22;color:${accent};padding:2px 10px;border-radius:20px;font-size:12px;font-weight:bold">${esc(typeLabel)}</span>
      <span style="color:#6b7280;font-size:12px;margin-left:6px">${esc(scope)}</span></p>
      <h2 style="margin:8px 0">${esc(s.title)}</h2>
      ${s.description ? `<p style="font-size:15px;line-height:1.6">${esc(s.description)}</p>` : ''}
      <table style="width:100%;font-size:14px;margin:10px 0;border-collapse:collapse">
        <tr><td style="color:#6b7280;padding:4px 0">When</td><td style="text-align:right;font-weight:bold">${esc(when)}</td></tr>
        ${s.duration_mins ? `<tr><td style="color:#6b7280;padding:4px 0">Duration</td><td style="text-align:right">${esc(s.duration_mins)} mins</td></tr>` : ''}
        <tr><td style="color:#6b7280;padding:4px 0">${s.mode === 'online' ? 'Join' : 'Venue'}</td><td style="text-align:right">${s.mode === 'online' ? (joinUrl ? `<a href="${joinUrl}" style="color:${accent}">Online link</a>` : 'Online') : esc(s.venue || '—')}</td></tr>
        ${s.trainer ? `<tr><td style="color:#6b7280;padding:4px 0">Facilitator</td><td style="text-align:right">${esc(s.trainer)}</td></tr>` : ''}
      </table>
      <p style="font-size:13px;color:#6b7280">Please make yourself available. Attendance will be recorded.</p>
      ${s.attachment_name ? `<p style="font-size:13px">📎 Attached: ${esc(s.attachment_name)}</p>` : ''}`

    let ok = false
    if (emails.length) {
      const to = [emails[0]]; const cc = emails.slice(1)
      const attachments = s.attachment_url ? [{ url: s.attachment_url, name: s.attachment_name || 'attachment' }] : []
      ok = await sendBrevo({ to, cc, subject: `[${org.name}] ${typeLabel}: ${s.title} — ${when}`, html: shell(org, org.accent_color, 'Training Scheduled', bodyHtml), attachments })
    }

    // Create/refresh the News Flash banner — notify_target null => no duplicate email
    const bannerBody = `${typeLabel} · ${when}${s.venue ? ' · ' + s.venue : ''}`
    let news_id = s.news_id
    const bannerRow = {
      org_id, title: `Training: ${s.title}`, body: bannerBody, category: 'event', priority: 'normal',
      department: s.audience === 'department' ? s.department : null,
      link_url: s.mode === 'online' ? s.link_url : null, link_label: s.mode === 'online' ? 'Join link' : null,
      starts_on: new Date().toISOString().slice(0, 10),
      ends_on: s.scheduled_at ? new Date(s.scheduled_at).toISOString().slice(0, 10) : null,
      active: true, notify_target: null,
    }
    if (news_id) { await sb.from('news_flash').update(bannerRow).eq('id', news_id).eq('org_id', org_id) }
    else {
      const { data: nf } = await sb.from('news_flash').insert(bannerRow).select().single()
      news_id = nf?.id
    }

    await sb.from('training_sessions').update({ announced_at: new Date().toISOString(), news_id }).eq('id', session_id).eq('org_id', org_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'training_announce', subject: s.title, recipients: emails, status: ok ? 'sent' : 'no-emails' })
    return json(200, { ok, emailed: emails.length, banner: !!news_id })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
