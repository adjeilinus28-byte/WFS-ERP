// Server-side AI operations report (keeps ANTHROPIC_API_KEY off the client).
// POST { org_id } -> { report }
// Caller must be signed in with insight view rights in org_id (the same rule
// as the Reports page). The monthly cron (scheduled-report) calls buildReport()
// directly instead of going through this HTTP handler.
const { admin, json, requireMember } = require('./_lib')

// Returns { report, facts } or throws.
async function buildReport(sb, org_id) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('ANTHROPIC_API_KEY not set'), { statusCode: 500 })
  const { data: org } = await sb.from('organizations').select('name, industry, currency').eq('id', org_id).maybeSingle()
  if (!org) throw Object.assign(new Error('organization not found'), { statusCode: 404 })
  const [{ data: assets }, { data: wos }, { data: inv }, { data: hse }] = await Promise.all([
    sb.from('assets').select('status, criticality').eq('org_id', org_id),
    sb.from('work_orders').select('status, priority, wo_type').eq('org_id', org_id),
    sb.from('inventory_items').select('qty_on_hand, reorder_level, unit_cost').eq('org_id', org_id),
    sb.from('hse_incidents').select('severity, status, incident_type').eq('org_id', org_id),
  ])

  const facts = {
    assets_total: assets?.length || 0,
    assets_down: assets?.filter((a) => a.status === 'down').length || 0,
    wo_open: wos?.filter((w) => ['open','in_progress','on_hold'].includes(w.status)).length || 0,
    wo_total: wos?.length || 0,
    low_stock: inv?.filter((i) => Number(i.qty_on_hand) <= Number(i.reorder_level)).length || 0,
    stock_value: inv?.reduce((s, i) => s + Number(i.qty_on_hand || 0) * Number(i.unit_cost || 0), 0) || 0,
    hse_open: hse?.filter((h) => h.status !== 'closed').length || 0,
    hse_critical: hse?.filter((h) => ['high','critical'].includes(h.severity)).length || 0,
  }

  const prompt = `You are an operations analyst for ${org.name} (${org.industry} sector). `
    + `Write a concise executive operations report (~250 words, plain prose, no markdown headers) from this data: `
    + `${JSON.stringify(facts)}. Currency is ${org.currency}. Cover asset health, maintenance load, `
    + `inventory risk, and HSE status. End with 3 prioritised recommended actions.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || 'AI request failed'), { statusCode: 502 })
  const report = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()

  await sb.from('notification_log').insert({ org_id, alert_type: 'ai_report', subject: 'Operations report generated', status: 'sent' })
  return { report, facts }
}

exports.buildReport = buildReport

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb, perms: [['insight', 'view']] })
    if (auth.error) return auth.error
    return json(200, await buildReport(sb, org_id))
  } catch (e) {
    return json(e.statusCode || 500, { error: e.message })
  }
}
