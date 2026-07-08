// Daily cron: (1) reminds attendees of sessions happening in ~2 days;
// (2) flags certifications expiring within 30 days to the employee + HSE head.
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, accent_color, hse_head_email')
  let reminders = 0, expiryAlerts = 0

  for (const org of orgs || []) {
    const accent = org.accent_color || '#F59E0B'

    // (1) Upcoming session reminders — sessions ~2 days out
    const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const { data: sessions } = await sb.from('training_sessions').select('*')
      .eq('org_id', org.id).eq('status', 'scheduled')
      .gte('scheduled_at', d2 + 'T00:00:00').lte('scheduled_at', d2 + 'T23:59:59')
    for (const s of sessions || []) {
      const { data: atts } = await sb.from('training_attendees').select('employee_id').eq('session_id', s.id)
      const ids = (atts || []).map((a) => a.employee_id).filter(Boolean)
      if (!ids.length) continue
      const { data: emps } = await sb.from('employees').select('email').in('id', ids).not('email', 'is', null)
      const emails = [...new Set((emps || []).map((e) => e.email).filter(Boolean))]
      if (!emails.length) continue
      const when = new Date(s.scheduled_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      const body = `<p>Reminder: you have training scheduled in 2 days.</p>
        <h3>${s.title}</h3><p><b>${when}</b>${s.venue ? ' · ' + s.venue : ''}${s.mode === 'online' && s.link_url ? ` · <a href="${s.link_url}">Online link</a>` : ''}</p>
        <p style="font-size:13px;color:#6b7280">Please make yourself available. Attendance will be recorded.</p>`
      const ok = await sendBrevo({ to: [emails[0]], cc: emails.slice(1), subject: `[${org.name}] Reminder: ${s.title} in 2 days`, html: shell(org.name, accent, 'Training Reminder', body) })
      if (ok) reminders++
    }

    // (2) Certificate expiry — completed certs expiring within 30 days
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    const { data: expiring } = await sb.from('training_attendees').select('*')
      .eq('org_id', org.id).eq('status', 'completed')
      .gte('expires_at', today).lte('expires_at', in30)
    if (expiring && expiring.length) {
      // Notify HSE head with the full list
      const rows = expiring.map((e) => `<tr><td style="padding:3px 8px;border-bottom:1px solid #eee">${e.employee_name || '—'}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${e.department || '—'}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${e.expires_at}</td></tr>`).join('')
      const body = `<p><b>${expiring.length}</b> certification(s) expire within 30 days and need renewal scheduling.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"><tr><td style="padding:3px 8px;font-weight:bold">Employee</td><td style="padding:3px 8px;font-weight:bold">Department</td><td style="padding:3px 8px;font-weight:bold">Expires</td></tr>${rows}</table>`
      const to = org.hse_head_email ? [org.hse_head_email] : await recipientsFor(sb, org.id, ['owner', 'admin', 'manager'])
      const ok = await sendBrevo({ to, subject: `[${org.name}] ${expiring.length} certification(s) expiring soon`, html: shell(org.name, accent, 'Certification Expiry', body) })
      if (ok) expiryAlerts++
      // Notify each affected employee individually
      const ids = expiring.map((e) => e.employee_id).filter(Boolean)
      if (ids.length) {
        const { data: emps } = await sb.from('employees').select('id,email').in('id', ids)
        for (const e of expiring) {
          const emp = (emps || []).find((x) => x.id === e.employee_id)
          if (!emp?.email) continue
          await sendBrevo({ to: [emp.email], subject: `[${org.name}] Your certification expires ${e.expires_at}`,
            html: shell(org.name, accent, 'Certification Expiry', `<p>Your certification is due to expire on <b>${e.expires_at}</b>. Please arrange renewal with your supervisor.</p>`) })
        }
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ reminders, expiryAlerts }) }
}
