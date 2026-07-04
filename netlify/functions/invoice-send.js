// Emails an invoice to the customer for review/approval via Brevo.
// POST { org_id, invoice_id }
const { admin, sendBrevo, shell, recipientsFor } = require('./_lib')

const money = (n, ccy) => `${ccy} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, invoice_id } = JSON.parse(event.body || '{}')
    if (!org_id || !invoice_id) return { statusCode: 400, body: JSON.stringify({ error: 'org_id and invoice_id required' }) }
    const sb = admin()
    const { data: org } = await sb.from('organizations').select('name, accent_color, currency, contact_email').eq('id', org_id).single()
    const { data: inv } = await sb.from('invoices').select('*').eq('id', invoice_id).single()
    if (!inv) return { statusCode: 404, body: JSON.stringify({ error: 'invoice not found' }) }
    if (!inv.customer_email) return { statusCode: 400, body: JSON.stringify({ error: 'no customer email on invoice' }) }
    const ccy = inv.currency || org?.currency || 'GHS'

    const body = `
      <p>Dear ${inv.customer},</p>
      <p>Please find invoice <b>${inv.invoice_no}</b> from ${org.name} for your review and approval.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr><td style="padding:5px 0;color:#6b7280">Invoice no.</td><td style="padding:5px 0;text-align:right">${inv.invoice_no}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Issue date</td><td style="padding:5px 0;text-align:right">${inv.issue_date || '—'}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Due date</td><td style="padding:5px 0;text-align:right">${inv.due_date || '—'}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Amount</td><td style="padding:5px 0;text-align:right">${money(inv.amount, ccy)}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Tax</td><td style="padding:5px 0;text-align:right">${money(inv.tax, ccy)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #111;font-size:16px">Total due</td><td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #111;font-size:16px">${money(inv.total, ccy)}</td></tr>
      </table>
      ${inv.document_url ? `<p><a href="${inv.document_url}" style="background:#F59E0B;color:#080C16;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">📄 View / download invoice document</a></p>` : ''}
      ${inv.reference ? `<p style="color:#6b7280;font-size:13px">Reference: ${inv.reference}</p>` : ''}
      <p style="margin-top:16px">Kindly review and confirm approval at your earliest convenience. For any queries, reply to this email${org.contact_email ? ` or contact ${org.contact_email}` : ''}.</p>`

    const ok = await sendBrevo({ to: [inv.customer_email], cc: inv.cc_emails, subject: `[${org.name}] Invoice ${inv.invoice_no} for approval — ${money(inv.total, ccy)}`, html: shell(org.name, org.accent_color, 'Invoice', body) })
    if (ok) await sb.from('invoices').update({ sent: true, sent_at: new Date().toISOString(), status: inv.status === 'draft' ? 'sent' : inv.status }).eq('id', invoice_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'invoice_sent', subject: `Invoice ${inv.invoice_no}`, recipients: [inv.customer_email], status: ok ? 'sent' : 'failed' })
    return { statusCode: 200, body: JSON.stringify({ ok }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
