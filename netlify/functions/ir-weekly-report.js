// Weekly digests: IRO gets all concerns; counsellor gets their referred cases.
// Cron in netlify.toml (weekly).
const { admin, sendBrevo, shell } = require('./_lib')

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, logo_url, accent_color, iro_email, counsellor_email')
  let sent = 0
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

  for (const org of orgs || []) {
    const { data: concerns } = await sb.from('ir_concerns').select('*').eq('org_id', org.id)
    if (!concerns) continue

    // IRO digest — full overview
    if (org.iro_email) {
      const open = concerns.filter((c) => !['resolved', 'closed'].includes(c.status))
      const newThisWeek = concerns.filter((c) => c.created_at >= weekAgo)
      const byCat = {}
      concerns.forEach((c) => { const k = c.category || 'unclassified'; byCat[k] = (byCat[k] || 0) + 1 })
      const urgent = open.filter((c) => c.severity === 'urgent' || c.severity === 'high')
      const stale = open.filter((c) => (Date.now() - new Date(c.updated_at || c.created_at)) / 86400000 >= 7)
      const rated = concerns.filter((c) => c.feedback_rating)
      const avgRating = rated.length ? (rated.reduce((s, c) => s + Number(c.feedback_rating), 0) / rated.length).toFixed(1) : null
      const rows = open.slice(0, 40).map((c) => `<tr><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.case_id}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.category || '—'}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.severity}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.status}</td></tr>`).join('')
      const body = `<p>Weekly Industrial Relations summary.</p>
        <p><b>${newThisWeek.length}</b> new this week · <b>${open.length}</b> open · <b>${urgent.length}</b> high/urgent · <b>${stale.length}</b> stale (7d+)</p>
        ${avgRating ? `<p>Resolution satisfaction: <b>${avgRating}/5</b> (${rated.length} rated)</p>` : ''}
        <p style="margin-top:8px"><b>By category:</b> ${Object.entries(byCat).map(([k, v]) => `${k} (${v})`).join(', ') || '—'}</p>
        ${stale.length ? `<p style="color:#b91c1c"><b>Ageing:</b> ${stale.length} open case(s) untouched 7+ days — ${stale.slice(0, 8).map((c) => c.case_id).join(', ')}.</p>` : ''}
        ${urgent.length ? `<p style="color:#b91c1c"><b>Attention:</b> ${urgent.length} case(s) marked high/urgent need review.</p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"><tr><td style="padding:3px 8px;font-weight:bold">Case</td><td style="padding:3px 8px;font-weight:bold">Category</td><td style="padding:3px 8px;font-weight:bold">Severity</td><td style="padding:3px 8px;font-weight:bold">Status</td></tr>${rows}</table>`
      const ok = await sendBrevo({ to: [org.iro_email], subject: `[${org.name}] Weekly IR report — ${open.length} open`, html: shell(org, org.accent_color, 'IR Weekly Report', body) })
      if (ok) sent++
      await sb.from('notification_log').insert({ org_id: org.id, alert_type: 'ir_weekly_iro', subject: 'IR weekly report', recipients: [org.iro_email], status: ok ? 'sent' : 'failed' })
    }

    // Counsellor digest — only referred cases
    if (org.counsellor_email) {
      const mine = concerns.filter((c) => c.referred_to_counsellor && !['resolved', 'closed'].includes(c.status))
      if (mine.length) {
        const rows = mine.map((c) => `<tr><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.case_id}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.category || '—'}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${(c.anonymous && !c.consent_reveal) ? 'Anonymous' : (c.employee_name || 'Identified')}</td><td style="padding:3px 8px;border-bottom:1px solid #eee">${c.status}</td></tr>`).join('')
        const body = `<p>Weekly counselling caseload summary.</p><p>You have <b>${mine.length}</b> active case(s).</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"><tr><td style="padding:3px 8px;font-weight:bold">Case</td><td style="padding:3px 8px;font-weight:bold">Category</td><td style="padding:3px 8px;font-weight:bold">Worker</td><td style="padding:3px 8px;font-weight:bold">Status</td></tr>${rows}</table>
          <p style="color:#6b7280;font-size:12px;margin-top:8px">Please continue to handle each case with care and confidentiality.</p>`
        const ok = await sendBrevo({ to: [org.counsellor_email], subject: `[${org.name}] Weekly counselling report — ${mine.length} active`, html: shell(org, org.accent_color, 'Counselling Weekly Report', body) })
        if (ok) sent++
        await sb.from('notification_log').insert({ org_id: org.id, alert_type: 'ir_weekly_counsellor', subject: 'Counselling weekly report', recipients: [org.counsellor_email], status: ok ? 'sent' : 'failed' })
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ digestsSent: sent }) }
}
