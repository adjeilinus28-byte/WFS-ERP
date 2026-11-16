// Daily alert sweep (cron declared in netlify.toml — NOT exports.config).
// Scans every active tenant for: low stock, service due, overdue work orders,
// document expiry, and open high/critical HSE cases, then emails managers via
// Brevo and writes a notification_log row per tenant.
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

const li = (s) => `<li style="margin:4px 0">${s}</li>`

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('status', 'active')
  let summary = []

  for (const org of orgs || []) {
    const oid = org.id
    const [{ data: inv }, { data: assets }, { data: wos }, { data: docs }, { data: hse }] = await Promise.all([
      sb.from('inventory_items').select('name, qty_on_hand, reorder_level, uom').eq('org_id', oid),
      sb.from('assets').select('name, next_service_date, status').eq('org_id', oid),
      sb.from('work_orders').select('wo_number, title, due_date, status').eq('org_id', oid),
      sb.from('documents_status').select('name, expiry_status, expiry_date').eq('org_id', oid),
      sb.from('hse_incidents').select('incident_no, severity, status, incident_type').eq('org_id', oid),
    ])

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const days = (d) => d ? Math.round((new Date(d).setHours(0,0,0,0) - today) / 86400000) : null

    const alerts = []
    ;(inv || []).filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level))
      .forEach((r) => alerts.push(`Low stock: <b>${r.name}</b> (${r.qty_on_hand} ${r.uom})`))
    ;(assets || []).forEach((a) => { const d = days(a.next_service_date); if (d != null && d <= 7) alerts.push(`Service ${d < 0 ? 'overdue' : `due in ${d}d`}: <b>${a.name}</b>`) })
    ;(wos || []).forEach((w) => { const d = days(w.due_date); if (d != null && d < 0 && !['done','cancelled'].includes(w.status)) alerts.push(`Overdue WO <b>${w.wo_number}</b>: ${w.title}`) })
    ;(docs || []).filter((x) => ['expired','critical','expiring'].includes(x.expiry_status))
      .forEach((x) => alerts.push(`Document <b>${x.name}</b> ${x.expiry_status}`))
    ;(hse || []).filter((h) => ['high','critical'].includes(h.severity) && h.status !== 'closed')
      .forEach((h) => alerts.push(`Open ${h.severity} HSE: <b>${h.incident_no}</b>`))

    if (alerts.length === 0) continue
    const to = await recipientsFor(sb, oid)
    const html = shell(org, org.accent_color, 'Daily Operations Alert',
      `<p>${alerts.length} item(s) need attention today:</p><ul>${alerts.map(li).join('')}</ul>`)
    const ok = await sendBrevo({ to, subject: `[${org.name}] ${alerts.length} operational alert(s)`, html })
    await sb.from('notification_log').insert({ org_id: oid, alert_type: 'daily_sweep', subject: `${alerts.length} alerts`, recipients: to, status: ok ? 'sent' : 'failed', detail: { count: alerts.length } })
    summary.push(`${org.name}: ${alerts.length}`)
  }
  return { statusCode: 200, body: JSON.stringify({ processed: (orgs || []).length, alerted: summary }) }
}
