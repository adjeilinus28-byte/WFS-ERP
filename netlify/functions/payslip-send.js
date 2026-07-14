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

      const line = (label, val, neg) => (Number(val) ? `<tr><td style="padding:5px 0;color:#374151">${label}</td><td style="padding:5px 0;text-align:right;color:${neg ? '#b91c1c' : '#111827'}">${neg ? '−' : ''}${money(val, ccy)}</td></tr>` : '')
      const body = `
        <p>Dear ${s.employee_name},</p>
        <p>Please find your payslip for <b>${s.period}</b>.</p>
        <table style="width:100%;font-size:13px;margin:8px 0 14px">
          <tr><td style="color:#6b7280">Job title</td><td style="text-align:right">${s.job_title || '—'}</td></tr>
          <tr><td style="color:#6b7280">Badge no.</td><td style="text-align:right">${s.badge_no || '—'}</td></tr>
          <tr><td style="color:#6b7280">Department</td><td style="text-align:right">${s.department || '—'}</td></tr>
          <tr><td style="color:#6b7280">Bank</td><td style="text-align:right">${s.bank_name || '—'}</td></tr>
          <tr><td style="color:#6b7280">No. of shifts / Off / Leave</td><td style="text-align:right">${s.no_of_shifts || 0} / ${s.off_days || 0} / ${s.leave_days || 0}</td></tr>
          <tr><td style="color:#6b7280">Attendance</td><td style="text-align:right">${s.attendance_pct || 0}%</td></tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td colspan="2" style="border-bottom:2px solid #eee;padding-bottom:6px;font-weight:bold">Earnings</td></tr>
          ${line('Basic salary', s.basic_pay)}
          ${(() => {
            // Legacy fixed fields (only present on older payslips)
            const legacy = [
              ['Salary difference', s.salary_difference], ['Mobile phone credit', s.mobile_credit],
              ['Transport allowance', s.transport_allowance], ['Canteen allowance', s.canteen_allowance],
              ['Extra duty / acting', s.extra_duty_allowance], ['Medical allowance', s.medical_allowance],
              ['Fuel allowance', s.fuel_allowance],
            ].map(([lbl, v]) => line(lbl, v)).join('')

            const detail = Array.isArray(s.pay_allowances_detail) ? s.pay_allowances_detail : []
            if (detail.length === 0) {
              // no itemized detail (old slip) → single line fallback
              return legacy + line('Other allowances', s.allowances)
            }
            // Grouped Allowances section: subheading, each item (with taxable note), subtotal
            const rows = detail.map((a) => {
              const tag = a.basis === 'daily' ? ' (daily)' : a.basis === 'per_leave_day' ? ' (per leave day)' : a.basis === 'annual' ? ' (annual)' : ''
              const taxNote = Number(a.taxable) > 0 ? ` <span style="color:#9ca3af;font-size:11px">(taxable ${money(a.taxable, ccy)})</span>` : ''
              return `<tr><td style="padding:4px 0 4px 14px;color:#374151">${(a.label || 'Allowance')}${tag}${taxNote}</td><td style="padding:4px 0;text-align:right;color:#111827">${money(a.pay, ccy)}</td></tr>`
            }).join('')
            const subtotal = detail.reduce((t, a) => t + Number(a.pay || 0), 0)
            const heading = `<tr><td colspan="2" style="padding:8px 0 2px;font-weight:600;color:#374151">Allowances</td></tr>`
            const sub = `<tr><td style="padding:4px 0 6px 14px;color:#6b7280;font-style:italic">Allowances subtotal</td><td style="padding:4px 0 6px;text-align:right;color:#374151;font-weight:600">${money(subtotal, ccy)}</td></tr>`
            return legacy + heading + rows + sub
          })()}
          ${line('Bonus', s.bonus)}
          ${line('12-hr shift overtime', s.shift_overtime)}
          ${Number(s.overtime_hours) > 0
            ? line(`Overtime (${s.overtime_hours} hrs × ${money(s.overtime_rate, ccy)})`, s.weekday_overtime)
            : line('Weekday overtime', s.weekday_overtime)}
          ${line('Public holiday overtime', s.holiday_overtime)}
          ${line('Arrears overtime', s.arrears_overtime)}
          <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #eee">Gross pay</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #eee">${money(s.gross_pay, ccy)}</td></tr>
          <tr><td colspan="2" style="border-bottom:2px solid #eee;padding:10px 0 6px;font-weight:bold">Deductions</td></tr>
          ${line(`SSNIT / SSF (${s.ssnit_rate || 5.5}%)`, s.ssnit, true)}
          ${line('Income tax (PAYE)', s.paye_amount, true)}
          ${line('Overtime tax', s.overtime_tax, true)}
          ${line('Union dues', s.union_dues, true)}
          ${line('Rent', s.rent_deduction, true)}
          ${line('SSNIT loan', s.ssnit_loan, true)}
          ${line('Other deductions', s.other_deductions, true)}
          <tr><td style="padding:6px 0;font-weight:bold;border-top:1px solid #eee">Total deductions</td><td style="padding:6px 0;text-align:right;font-weight:bold;border-top:1px solid #eee;color:#b91c1c">−${money(s.deductions, ccy)}</td></tr>
          <tr><td style="padding:10px 0;font-weight:bold;font-size:16px;border-top:2px solid #111">Net pay</td><td style="padding:10px 0;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #111;color:#16a34a">${money(s.net_pay, ccy)}</td></tr>
        </table>
        <table style="width:100%;font-size:12px;color:#6b7280;margin-top:10px">
          ${s.taxable_income ? `<tr><td>Taxable income</td><td style="text-align:right">${money(s.taxable_income, ccy)}</td></tr>` : ''}
          ${s.ssnit_employer ? `<tr><td>Employer SSNIT (${s.ssnit_employer_rate || 13}%)</td><td style="text-align:right">${money(s.ssnit_employer, ccy)}</td></tr>` : ''}
        </table>
        <p style="color:#6b7280;font-size:12px;margin-top:10px">This payslip is confidential.</p>`
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
