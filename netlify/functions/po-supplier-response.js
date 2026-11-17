// Public endpoint hit from the supplier's email accept/decline links.
// GET /po-supplier-response?po=UUID&token=XYZ&decision=accepted|declined
// On accept: marks PO accepted + auto-creates a Bill (AP) in Accounts and
// notifies the buyer. Token-gated (no auth session needed).
const { admin, sendBrevo, shell, recipientsFor, esc } = require('./_lib')

const page = (title, msg, color) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family:Arial,sans-serif;background:#080C16;color:#F1F5F9;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="max-width:420px;text-align:center;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px 28px;background:#0E1424">
    <div style="width:56px;height:56px;border-radius:14px;background:${color}22;display:grid;place-items:center;margin:0 auto 16px;font-size:28px">${title.includes('Accept') ? '✓' : title.includes('Declin') ? '✗' : 'ℹ'}</div>
    <h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6">${esc(msg)}</p>
    <p style="color:#64748B;font-size:11px;margin-top:24px">Powered by WorkFlow Solutions</p>
  </div>
</body></html>`

exports.handler = async (event) => {
  const { po, token, decision } = event.queryStringParameters || {}
  const html = (t, m, c) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: page(t, m, c) })

  if (!po || !token || !['accepted', 'declined'].includes(decision)) {
    return html('Invalid link', 'This approval link is missing information or malformed.', '#F59E0B')
  }
  try {
    const sb = admin()
    const { data: order } = await sb.from('purchase_orders').select('*').eq('id', po).single()
    if (!order || order.supplier_token !== token) {
      return html('Link not valid', 'This order could not be found or the link has expired.', '#F59E0B')
    }
    if (order.supplier_status && order.supplier_status !== 'pending') {
      return html('Already responded', `This order was already marked "${order.supplier_status}". No further action is needed.`, '#60A5FA')
    }

    const patch = { supplier_status: decision, supplier_decided_at: new Date().toISOString() }
    if (decision === 'accepted') patch.status = 'sent'
    await sb.from('purchase_orders').update(patch).eq('id', po)

    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', order.org_id).single()
    const { data: sup } = order.supplier_id ? await sb.from('suppliers').select('*').eq('id', order.supplier_id).eq('org_id', order.org_id).maybeSingle() : { data: null }

    if (decision === 'accepted') {
      // Auto-create a Bill (Accounts Payable) for follow-up, if none yet.
      let billId = order.bill_id
      if (!billId) {
        const { data: bill } = await sb.from('bills').insert({
          org_id: order.org_id,
          bill_no: `BILL-${(order.po_number || 'PO').replace(/[^0-9A-Za-z]/g, '')}`,
          supplier: sup?.name || null,
          status: 'received',
          issue_date: new Date().toISOString().slice(0, 10),
          amount: order.total || 0, tax: 0, total: order.total || 0,
          notes: `Auto-created from accepted PO ${order.po_number}`,
        }).select().single()
        billId = bill?.id
        if (billId) await sb.from('purchase_orders').update({ bill_id: billId }).eq('id', po)
      }
      // Notify buyer + accounts
      const to = await recipientsFor(sb, order.org_id, ['owner', 'admin', 'manager'])
      await sendBrevo({ to, subject: `[${org.name}] Supplier ACCEPTED PO ${order.po_number}`,
        html: shell(org, org.accent_color, 'Procurement',
          `<p><b>${esc(sup?.name || 'Supplier')}</b> accepted PO <b>${esc(order.po_number)}</b> (${esc(order.currency)} ${esc(Number(order.total||0).toLocaleString())}).</p>
           <p>A bill has been created in Accounts → Bills for follow-up.</p>`) })
      await sb.from('notification_log').insert({ org_id: order.org_id, alert_type: 'po_accepted', subject: `PO ${order.po_number} accepted`, status: 'sent' })
      return html('Order Accepted', `Thank you. Your acceptance of PO ${order.po_number} has been recorded and ${org.name} has been notified.`, '#16a34a')
    } else {
      const to = await recipientsFor(sb, order.org_id, ['owner', 'admin', 'manager'])
      await sendBrevo({ to, subject: `[${org.name}] Supplier DECLINED PO ${order.po_number}`,
        html: shell(org, org.accent_color, 'Procurement',
          `<p><b>${esc(sup?.name || 'Supplier')}</b> declined PO <b>${esc(order.po_number)}</b>. You may wish to revise the order or contact another supplier.</p>`) })
      await sb.from('notification_log').insert({ org_id: order.org_id, alert_type: 'po_declined', subject: `PO ${order.po_number} declined`, status: 'sent' })
      return html('Order Declined', `Your response has been recorded and ${org.name} has been notified.`, '#dc2626')
    }
  } catch (e) {
    return html('Something went wrong', 'Please contact the buyer directly. ' + (e.message || ''), '#F59E0B')
  }
}
