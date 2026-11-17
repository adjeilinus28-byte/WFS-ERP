// Emails an invoice to the customer for review/approval via Brevo.
// POST { org_id, invoice_id }
// Caller must be signed in with finance edit rights in org_id (the same rule
// the database applies to invoices); the invoice is only looked up inside that
// workspace, and everything typed is HTML-escaped.
const { admin, sendBrevo, shell, esc, safeUrl, json, requireMember } = require('./_lib')

const money = (n, ccy) => esc(`${ccy} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, invoice_id } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb, perms: [['finance', 'edit']] })
    if (auth.error) return auth.error
    if (!invoice_id) return json(400, { error: 'org_id and invoice_id required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color, currency, contact_email').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: inv } = await sb.from('invoices').select('*').eq('id', invoice_id).eq('org_id', org_id).maybeSingle()
    if (!inv) return json(404, { error: 'invoice not found' })
    if (!inv.customer_email) return json(400, { error: 'no customer email on invoice' })
    const ccy = inv.currency || org.currency || 'GHS'
    const docUrl = safeUrl(inv.document_url)

    const body = `
      <p>Dear ${esc(inv.customer)},</p>
      <p>Please find invoice <b>${esc(inv.invoice_no)}</b> from ${esc(org.name)} for your review and approval.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr><td style="padding:5px 0;color:#6b7280">Invoice no.</td><td style="padding:5px 0;text-align:right">${esc(inv.invoice_no)}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Issue date</td><td style="padding:5px 0;text-align:right">${esc(inv.issue_date || '—')}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Due date</td><td style="padding:5px 0;text-align:right">${esc(inv.due_date || '—')}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Amount</td><td style="padding:5px 0;text-align:right">${money(inv.amount, ccy)}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280">Tax</td><td style="padding:5px 0;text-align:right">${money(inv.tax, ccy)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #111;font-size:16px">Total due</td><td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #111;font-size:16px">${money(inv.total, ccy)}</td></tr>
      </table>
      ${docUrl ? `<p><a href="${docUrl}" style="background:#F59E0B;color:#080C16;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">📄 View / download invoice document</a></p>` : ''}
      ${inv.reference ? `<p style="color:#6b7280;font-size:13px">Reference: ${esc(inv.reference)}</p>` : ''}
      <p style="margin-top:16px">Kindly review and confirm approval at your earliest convenience. For any queries, reply to this email${org.contact_email ? ` or contact ${esc(org.contact_email)}` : ''}.</p>`

    const subjectTotal = `${ccy} ${Number(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    const ok = await sendBrevo({ to: [inv.customer_email], cc: inv.cc_emails, subject: `[${org.name}] Invoice ${inv.invoice_no} for approval — ${subjectTotal}`, html: shell(org, org.accent_color, 'Invoice', body) })
    if (ok) await sb.from('invoices').update({ sent: true, sent_at: new Date().toISOString(), status: inv.status === 'draft' ? 'sent' : inv.status }).eq('id', invoice_id).eq('org_id', org_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'invoice_sent', subject: `Invoice ${inv.invoice_no}`, recipients: [inv.customer_email], status: ok ? 'sent' : 'failed' })
    return json(200, { ok })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
