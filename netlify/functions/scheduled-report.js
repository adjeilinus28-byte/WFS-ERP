// Monthly cron (declared in netlify.toml). Generates an AI report per active
// tenant and emails it to leadership via Brevo.
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('status', 'active')
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
  let sent = 0

  for (const org of orgs || []) {
    try {
      const r = await fetch(`${base}/.netlify/functions/generate-report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id }),
      })
      const { report } = await r.json()
      if (!report) continue
      const to = await recipientsFor(sb, org.id, ['owner', 'admin'])
      const html = shell(org, org.accent_color, 'Monthly Operations Report',
        `<div style="white-space:pre-wrap">${report.replace(/</g, '&lt;')}</div>`)
      await sendBrevo({ to, subject: `[${org.name}] Monthly operations report`, html })
      sent++
    } catch (e) { console.error('monthly report failed for', org.name, e.message) }
  }
  return { statusCode: 200, body: JSON.stringify({ sent }) }
}
