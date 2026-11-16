// Scheduled: sends a daily catering summary per department for the next 2 days,
// so caterers/kitchen can prepare. Cron in netlify.toml.
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, logo_url, accent_color, contact_email')
  let sent = 0

  for (const org of orgs || []) {
    const dates = [1, 2].map((n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10))
    const { data: orders } = await sb.from('food_orders').select('*')
      .eq('org_id', org.id).in('service_date', dates).eq('no_meal', false).neq('status', 'cancelled')
    if (!orders || orders.length === 0) continue

    // Build: date → department → item → count
    let html = ''
    for (const d of dates) {
      const dayOrders = orders.filter((o) => o.service_date === d)
      if (dayOrders.length === 0) continue
      const label = new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
      html += `<h3 style="margin:16px 0 6px">${label} — ${dayOrders.length} meals</h3>`
      const byDept = {}
      dayOrders.forEach((o) => { (byDept[o.department || 'Unassigned'] ||= []).push(o) })
      for (const [dept, list] of Object.entries(byDept)) {
        const byItem = {}
        list.forEach((o) => { const k = `${o.meal_type}: ${o.item_name}`; byItem[k] = (byItem[k] || 0) + 1 })
        const rows = Object.entries(byItem).sort().map(([k, c]) => `<tr><td style="padding:3px 8px;border-bottom:1px solid #eee">${k}</td><td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right">${c}</td></tr>`).join('')
        html += `<p style="margin:8px 0 2px;font-weight:bold">${dept} (${list.length})</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>`
        // Note any allergies
        const allergies = list.filter((o) => o.allergies).map((o) => `${o.employee_name}: ${o.allergies}`)
        if (allergies.length) html += `<p style="font-size:12px;color:#b91c1c;margin:4px 0">⚠ Allergies — ${allergies.join('; ')}</p>`
      }
    }
    if (!html) continue

    const to = await recipientsFor(sb, org.id, ['owner', 'admin', 'manager'])
    if (org.contact_email && !to.includes(org.contact_email)) to.push(org.contact_email)
    const ok = await sendBrevo({ to, subject: `[${org.name}] Catering summary — next 2 days`, html: shell(org, org.accent_color, 'Catering Summary', html) })
    if (ok) sent++
    await sb.from('notification_log').insert({ org_id: org.id, alert_type: 'catering_summary', subject: 'Catering summary (2 days)', recipients: to, status: ok ? 'sent' : 'failed' })

    // ── Per-vendor summaries: each active vendor with an email gets only their items ──
    const { data: vendors } = await sb.from('food_vendors').select('id, name, email').eq('org_id', org.id).eq('active', true).not('email', 'is', null)
    for (const v of vendors || []) {
      const vOrders = orders.filter((o) => o.vendor_id === v.id)
      if (vOrders.length === 0) continue
      let vhtml = `<p>Dear ${v.name},</p><p>Here is the order summary for meals to prepare over the next 2 days.</p>`
      for (const d of dates) {
        const dayOrders = vOrders.filter((o) => o.service_date === d)
        if (dayOrders.length === 0) continue
        const label = new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
        vhtml += `<h3 style="margin:16px 0 6px">${label} — ${dayOrders.length} meals</h3>`
        // Totals per item (what to cook)
        const byItem = {}
        dayOrders.forEach((o) => { const k = `${o.meal_type}: ${o.item_name}`; byItem[k] = (byItem[k] || 0) + 1 })
        const itemRows = Object.entries(byItem).sort().map(([k, c]) => `<tr><td style="padding:3px 8px;border-bottom:1px solid #eee">${k}</td><td style="padding:3px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${c}</td></tr>`).join('')
        vhtml += `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:6px"><tr><td style="padding:3px 8px;font-weight:bold">Item</td><td style="padding:3px 8px;text-align:right;font-weight:bold">Qty</td></tr>${itemRows}</table>`
        // Delivery breakdown by department
        const byDept = {}
        dayOrders.forEach((o) => { (byDept[o.department || 'Unassigned'] ||= 0); byDept[o.department || 'Unassigned']++ })
        vhtml += `<p style="font-size:12px;color:#6b7280;margin:2px 0">Delivery by department: ${Object.entries(byDept).map(([dep, c]) => `${dep} (${c})`).join(', ')}</p>`
        // Allergies relevant to this vendor's orders
        const allergies = dayOrders.filter((o) => o.allergies).map((o) => `${o.employee_name}: ${o.allergies}`)
        if (allergies.length) vhtml += `<p style="font-size:12px;color:#b91c1c;margin:4px 0">⚠ Allergies — ${allergies.join('; ')}</p>`
      }
      const vok = await sendBrevo({ to: [v.email], subject: `[${org.name}] Your order summary — next 2 days`, html: shell(org, org.accent_color, 'Vendor Order Summary', vhtml) })
      await sb.from('notification_log').insert({ org_id: org.id, alert_type: 'vendor_summary', subject: `Vendor summary — ${v.name}`, recipients: [v.email], status: vok ? 'sent' : 'failed' })
    }
  }
  return { statusCode: 200, body: JSON.stringify({ orgsSummarised: sent }) }
}
