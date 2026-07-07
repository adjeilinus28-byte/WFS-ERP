// Scheduled: at the 2-day cutoff, auto-selects meals for workers who didn't order.
// Fallback = the worker's most-frequent item NAME for that weekday + meal type.
// Skips workers on approved leave for the target date. Cron in netlify.toml.
const { admin } = require('./_lib')

const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

exports.handler = async () => {
  const sb = admin()
  // Target date = 2 days from now (the day whose window is closing)
  const target = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  const weekday = new Date(target).getDay()
  const { data: orgs } = await sb.from('organizations').select('id').eq('status', 'active')
  let created = 0

  for (const org of orgs || []) {
    const orgId = org.id
    // Menu available for the target date, grouped by meal type
    const { data: menus } = await sb.from('menu_items').select('*').eq('org_id', orgId).eq('service_date', target).eq('available', true)
    if (!menus || menus.length === 0) continue
    const mealTypes = [...new Set(menus.map((m) => m.meal_type))]

    // Employees in the org
    const { data: emps } = await sb.from('employees').select('id, full_name, department').eq('org_id', orgId)
    // Approved leave covering the target date
    const { data: leave } = await sb.from('leave_requests').select('employee_id')
      .eq('org_id', orgId).eq('status', 'approved').lte('start_date', target).gte('end_date', target)
    const onLeave = new Set((leave || []).map((l) => l.employee_id))

    // Shift data: skip employees whose shift on the target date is 'off',
    // unless they have an approved callout for that day.
    const [{ data: pats }, { data: assigns }, { data: ovs }, { data: cls }] = await Promise.all([
      sb.from('shift_patterns').select('*').eq('org_id', orgId),
      sb.from('employee_shift_assignments').select('*').eq('org_id', orgId),
      sb.from('shift_overrides').select('*').eq('org_id', orgId).eq('shift_date', target),
      sb.from('callout_requests').select('employee_id, status').eq('org_id', orgId).eq('service_date', target),
    ])
    const approvedCallout = new Set((cls || []).filter((c) => c.status === 'approved').map((c) => c.employee_id))
    const shiftOf = (empId) => {
      const ov = (ovs || []).find((o) => o.employee_id === empId)
      if (ov) return ov.shift
      const mine = (assigns || []).filter((a) => a.employee_id === empId)
        .sort((a, b) => new Date(b.effective_from) - new Date(a.effective_from))
      const a = mine.find((x) => new Date(x.effective_from) <= new Date(target))
      if (!a) return null
      const p = (pats || []).find((x) => x.id === a.pattern_id)
      const cyc = Array.isArray(p?.cycle) ? p.cycle : []
      if (!cyc.length) return null
      const diff = Math.round((new Date(target) - new Date(p.anchor_date)) / 86400000)
      return cyc[((diff % cyc.length) + cyc.length) % cyc.length]
    }

    // Existing orders for the target date
    const { data: existing } = await sb.from('food_orders').select('employee_id, meal_type').eq('org_id', orgId).eq('service_date', target)
    const has = new Set((existing || []).map((o) => `${o.employee_id}:${o.meal_type}`))

    // History for weekday-based fallback
    const { data: history } = await sb.from('food_orders').select('employee_id, meal_type, item_name, vendor_id, menu_item_id, price, service_date')
      .eq('org_id', orgId).eq('no_meal', false)

    for (const emp of emps || []) {
      if (onLeave.has(emp.id)) continue
      if (shiftOf(emp.id) === 'off' && !approvedCallout.has(emp.id)) continue
      for (const mt of mealTypes) {
        if (has.has(`${emp.id}:${mt}`)) continue   // already ordered
        // Most-frequent item name for this weekday + meal type
        const hist = (history || []).filter((h) => h.employee_id === emp.id && h.meal_type === mt && WEEKDAY[new Date(h.service_date).getDay()] === WEEKDAY[weekday])
        let chosen = null
        if (hist.length) {
          const freq = {}
          hist.forEach((h) => { freq[h.item_name] = (freq[h.item_name] || 0) + 1 })
          const topName = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
          chosen = menus.find((m) => m.meal_type === mt && m.name === topName)
        }
        // Fallback: cheapest/first available item for that meal type
        if (!chosen) chosen = menus.filter((m) => m.meal_type === mt).sort((a, b) => a.price - b.price)[0]
        if (!chosen) continue

        await sb.from('food_orders').insert({
          org_id: orgId, employee_id: emp.id, employee_name: emp.full_name, department: emp.department,
          service_date: target, meal_type: mt, vendor_id: chosen.vendor_id, menu_item_id: chosen.id,
          item_name: chosen.name, price: chosen.price, auto_selected: true, status: 'auto',
        })
        created++
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ target, autoCreated: created }) }
}
