// Monthly cron (declared in netlify.toml). Generates an AI report per active
// tenant and emails it to leadership via Brevo. Builds the report in-process
// (generate-report's HTTP handler needs a signed-in caller; the cron has none).
const { admin, sendBrevo, shell, recipientsFor, esc } = require('./_lib')
const { buildReport } = require('./generate-report')

exports.handler = async () => {
  const sb = admin()
  const { data: orgs } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('status', 'active')
  let sent = 0

  for (const org of orgs || []) {
    try {
      const { report } = await buildReport(sb, org.id)
      if (!report) continue
      const to = await recipientsFor(sb, org.id, ['owner', 'admin'])
      const html = shell(org, org.accent_color, 'Monthly Operations Report',
        `<div style="white-space:pre-wrap">${esc(report)}</div>`)
      await sendBrevo({ to, subject: `[${org.name}] Monthly operations report`, html })
      sent++
    } catch (e) { console.error('monthly report failed for', org.name, e.message) }
  }
  return { statusCode: 200, body: JSON.stringify({ sent }) }
}
