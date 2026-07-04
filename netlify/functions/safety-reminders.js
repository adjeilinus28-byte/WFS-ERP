// Scheduled: reminds assignees of open CCV actions due within 3 days, and nudges
// observers who are behind on their monthly safety KPIs. Cron in netlify.toml.
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, accent_color').eq('status', 'active')
  let actionReminders = 0, kpiReminders = 0

  for (const org of orgs || []) {
    // 1) Open CCV actions due within 3 days
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    const { data: acts } = await sb.from('safety_interactions').select('*')
      .eq('org_id', org.id).eq('action_status', 'open').eq('action_required', true)
      .not('assigned_to_email', 'is', null).lte('action_due', soon)
    for (const a of acts || []) {
      const overdue = a.action_due && a.action_due < new Date().toISOString().slice(0, 10)
      const body = `<p>Reminder: a CCV action assigned to you is <b>${overdue ? 'OVERDUE' : 'due soon'}</b>.</p>
        <p><b>${a.ref_no || 'CCV'}</b> — ${a.action_description || ''}<br/>Due: ${a.action_due || 'ASAP'} · Location: ${a.location || '—'}</p>
        <p>Please close it out in the HSE module.</p>`
      const ok = await sendBrevo({ to: [a.assigned_to_email], subject: `[${org.name}] ${overdue ? 'OVERDUE' : 'Reminder'}: CCV action ${a.ref_no || ''}`, html: shell(org.name, org.accent_color, 'Safety Action Reminder', body) })
      if (ok) actionReminders++
    }

    // 2) KPI nudge near month-end (day >= 24): observers below target
    const day = new Date().getDate()
    if (day >= 24) {
      const { data: targets } = await sb.from('safety_targets').select('*').eq('org_id', org.id)
      const { data: kpi } = await sb.from('safety_kpi').select('*').eq('org_id', org.id)
      const { data: emps } = await sb.from('employees').select('id, full_name, email').eq('org_id', org.id)
      const targetFor = (role, ft) => (targets || []).find((t) => t.role === role && t.form_type === ft)?.monthly_target || 0
      for (const e of emps || []) {
        if (!e.email) continue
        const rows = (kpi || []).filter((k) => k.observer_id === e.id)
        const behind = ['ccv', 'pto', 'take5'].map((ft) => {
          const done = rows.find((r) => r.form_type === ft)?.done_this_month || 0
          const tgt = targetFor(rows[0]?.observer_role, ft)
          return tgt > done ? `${ft.toUpperCase()}: ${done}/${tgt}` : null
        }).filter(Boolean)
        if (behind.length) {
          const body = `<p>Month-end reminder: your safety interaction KPIs are below target.</p>
            <p>${behind.join('<br/>')}</p><p>Please complete your outstanding CCVs / PTOs / Take 5s before month end.</p>`
          const ok = await sendBrevo({ to: [e.email], subject: `[${org.name}] Safety KPI reminder — ${behind.length} target(s) outstanding`, html: shell(org.name, org.accent_color, 'Safety KPI', body) })
          if (ok) kpiReminders++
        }
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ actionReminders, kpiReminders }) }
}
