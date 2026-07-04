// Emails payslips via Brevo. POST { org_id, ids: [payroll_id,...] } OR { org_id, period, department? }
// Sends an individual branded payslip to each employee's email and marks sent.
const { admin, sendBrevo, shell } = require('./_lib')

const money = (n, ccy) => `${ccy} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, ids, period, department } = JSON.parse(event.body || '{}')
    if (!org_id) return { statusCode: 400, body: JSON.stringify({ error: 'org_id required' }) }
    const sb = admin()
    const { data: org } = await sb.from('organizations').select('name, accent_color, currency').eq('id', org_id).single()
    const ccy = org?.currency || 'GHS'

    let q = sb.from('payroll').select('*').eq('org_id', org_id)
    if (ids && ids.length) q = q.in('id', ids)
    else if (period) { q = q.eq('period', period); if (department) q = q.eq('department', department) }
    const { data: slips } = await q
    if (!slips || slips.length === 0) return { statusCode: 200, body: JSON.stringify({ sent: 0, skipped: 0, note: 'no matching payroll rows' }) }

    let sent = 0, skipped = 0
    for (const s of slips) {
      // Resolve email: row email → linked employee email
      let email = s.email
      if (!email && s.employee_id) {
        const { data: emp } = await sb.from('employees').select('email').eq('id', s.employee_id).single()
        email = emp?.email
      }
      if (!email) { skipped++; continue }

      const line = (label, val, neg) => `<tr><td style="padding:6px 0;color:#374151">${label}</td><td style="padding:6px 0;text-align:right;color:${neg ? '#b91c1c' : '#111827'}">${neg ? '−' : ''}${money(val, ccy)}</td></tr>`
      const body = `
        <p>Dear ${s.employee_name},</p>
        <p>Please find your payslip for <b>${s.period}</b>.</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px">
          <tr><td colspan="2" style="border-bottom:2px solid #eee;padding-bottom:6px;font-weight:bold">Earnings</td></tr>
          ${line('Basic pay', s.basic_pay)}
          ${line('Overtime', s.overtime)}
          ${line('Bonus', s.bonus)}
          ${line('Allowances', s.allowances)}
          <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #eee">Gross pay</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #eee">${money(s.gross_pay, ccy)}</td></tr>
          <tr><td colspan="2" style="border-bottom:2px solid #eee;padding:10px 0 6px;font-weight:bold">Deductions</td></tr>
          ${line('PAYE / Tax', s.tax, true)}
          ${line('SSNIT', s.ssnit, true)}
          ${line('Other deductions', s.other_deductions, true)}
          <tr><td style="padding:10px 0;font-weight:bold;font-size:16px;border-top:2px solid #111">Net pay</td><td style="padding:10px 0;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #111;color:#16a34a">${money(s.net_pay, ccy)}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:12px">Department: ${s.department || '—'}. This payslip is confidential.</p>`
      const ok = await sendBrevo({ to: [email], subject: `[${org.name}] Payslip — ${s.period}`, html: shell(org.name, org.accent_color, 'Payslip', body) })
      if (ok) { await sb.from('payroll').update({ payslip_sent: true, sent_at: new Date().toISOString(), email }).eq('id', s.id); sent++ }
      else skipped++
    }

    await sb.from('notification_log').insert({ org_id, alert_type: 'payslips', subject: `Payslips ${period || 'batch'} (${sent} sent)`, status: 'sent', detail: { sent, skipped } })
    return { statusCode: 200, body: JSON.stringify({ sent, skipped }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
