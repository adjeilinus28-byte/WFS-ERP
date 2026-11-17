// Procurement workflow notifications via Brevo.
// POST { org_id, event, request_id?, po_id? }
//   event: request_submitted | request_approved | request_declined | po_to_supplier
// Everything people type (titles, notes, names, line items) is HTML-escaped with
// esc() before it goes into an email body, and records are only looked up inside
// the workspace named in the call. The caller must be signed in and a member of
// that workspace; po_to_supplier also needs supply-chain edit rights (the same
// rule the database applies to purchase orders). Each event must match the
// record's own state or nothing is sent (409): request_submitted only for a
// pending request created in the last 15 minutes, request_approved / declined
// only when the request has that status and the caller may decide purchase
// requests (same rule as the database's check_approval(); 403 otherwise),
// po_to_supplier only while the supplier has not answered yet.
const { admin, sendBrevo, shell, recipientsFor, esc, isRecent, requireMember, canDecide } = require('./_lib')

const crypto = require('crypto')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, event: kind, request_id, po_id } = JSON.parse(event.body || '{}')
    const sb = admin()
    const perms = kind === 'po_to_supplier' ? [['supply_chain', 'edit']] : undefined
    const auth = await requireMember(event, org_id, { sb, perms })
    if (auth.error) return auth.error
    if (!kind) return { statusCode: 400, body: JSON.stringify({ error: 'org_id and event required' }) }
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return { statusCode: 404, body: JSON.stringify({ error: 'organization not found' }) }
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
    let to, subject, body, cc

    if (kind === 'request_submitted' || kind === 'request_approved' || kind === 'request_declined') {
      const { data: pr } = await sb.from('purchase_requests').select('*').eq('id', request_id).eq('org_id', org_id).maybeSingle()
      if (!pr) return { statusCode: 404, body: JSON.stringify({ error: 'request not found' }) }
      if (kind === 'request_submitted' && !(pr.status === 'pending' && isRecent(pr.created_at))) {
        return { statusCode: 409, body: JSON.stringify({ error: 'request is not a new pending request' }) }
      }
      if (kind !== 'request_submitted' && pr.status !== (kind === 'request_approved' ? 'approved' : 'declined')) {
        return { statusCode: 409, body: JSON.stringify({ error: 'request status does not match' }) }
      }
      if (kind !== 'request_submitted' && !(await canDecide(sb, org_id, auth.member, 'purchase_request'))) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Only an approver can send a purchase request decision' }) }
      }
      cc = pr.cc_emails

      if (kind === 'request_submitted') {
        // notify the chosen approver (fallback to admins)
        to = pr.approver_email ? [pr.approver_email] : await recipientsFor(sb, org_id, ['owner', 'admin'])
        subject = `[${org.name}] Purchase request awaiting your approval: ${pr.title}`
        body = `<p>A purchase request needs your approval.</p>
          <p><b>Title:</b> ${esc(pr.title)}<br/><b>Requested by:</b> ${esc(pr.requested_by || '—')} (${esc(pr.department || '—')})<br/>
          <b>Estimated total:</b> ${esc(pr.currency)} ${Number(pr.est_total || 0).toLocaleString()}<br/>
          <b>Needed by:</b> ${esc(pr.needed_by || '—')}<br/><b>Priority:</b> ${esc(pr.priority)}</p>
          <p><b>Justification:</b> ${esc(pr.justification || '—')}</p>
          <p>Open the Procurement → Requests tab to approve or decline.</p>`
      } else {
        const approved = kind === 'request_approved'
        to = [pr.requested_by].filter((x) => x && x.includes('@'))
        if (to.length === 0) to = await recipientsFor(sb, org_id, ['owner', 'admin'])
        subject = `[${org.name}] Purchase request ${approved ? 'approved' : 'declined'}: ${pr.title}`
        body = `<p>Your purchase request <b>${esc(pr.title)}</b> has been <b>${approved ? 'approved' : 'declined'}</b>.</p>
          ${pr.decision_note ? `<p><b>Note:</b> ${esc(pr.decision_note)}</p>` : ''}
          ${approved ? '<p>It can now be converted into a Purchase Order.</p>' : ''}`
      }
    } else if (kind === 'po_to_supplier') {
      const { data: po } = await sb.from('purchase_orders').select('*').eq('id', po_id).eq('org_id', org_id).maybeSingle()
      if (!po) return { statusCode: 404, body: JSON.stringify({ error: 'PO not found' }) }
      if (po.supplier_status && po.supplier_status !== 'pending') {
        return { statusCode: 409, body: JSON.stringify({ error: `supplier already ${po.supplier_status} this order` }) }
      }
      cc = po.cc_emails
      const { data: sup } = po.supplier_id ? await sb.from('suppliers').select('*').eq('id', po.supplier_id).eq('org_id', org_id).maybeSingle() : { data: null }
      if (!sup?.email) return { statusCode: 400, body: JSON.stringify({ error: 'supplier has no email' }) }

      // Ensure a token exists for the accept/decline links
      let token = po.supplier_token
      if (!token) {
        token = crypto.randomBytes(24).toString('hex')
        await sb.from('purchase_orders').update({ supplier_token: token, supplier_status: 'pending' }).eq('id', po.id).eq('org_id', org_id)
      }
      const link = (decision) => `${base}/.netlify/functions/po-supplier-response?po=${encodeURIComponent(po.id)}&token=${token}&decision=${decision}`
      const { data: lines } = await sb.from('purchase_order_lines').select('*').eq('po_id', po.id)
      const rowsHtml = (lines || []).map((l) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(l.description)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${esc(l.qty)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${esc(po.currency)} ${Number(l.unit_price).toLocaleString()}</td></tr>`).join('')

      to = [sup.email]
      subject = `[${org.name}] Purchase Order ${po.po_number} for your approval`
      body = `<p>Dear ${esc(sup.contact_name || sup.name)},</p>
        <p>${esc(org.name)} would like to place the following order:</p>
        <p><b>PO:</b> ${esc(po.po_number)}<br/><b>Total:</b> ${esc(po.currency)} ${Number(po.total || 0).toLocaleString()}<br/><b>Expected:</b> ${esc(po.expected_date || '—')}</p>
        ${rowsHtml ? `<table style="border-collapse:collapse;width:100%;margin:8px 0"><tr><th style="text-align:left;padding:4px 8px">Item</th><th style="text-align:right;padding:4px 8px">Qty</th><th style="text-align:right;padding:4px 8px">Unit</th></tr>${rowsHtml}</table>` : ''}
        <p style="margin-top:16px">
          <a href="${link('accepted')}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px">✓ Accept order</a>
          <a href="${link('declined')}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">✗ Decline</a>
        </p>`
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'unknown event' }) }
    }

    const ok = await sendBrevo({ to, cc, subject, html: shell(org, org.accent_color, 'Procurement', body) })
    await sb.from('notification_log').insert({ org_id, alert_type: kind, subject, recipients: to, status: ok ? 'sent' : 'failed' })
    return { statusCode: 200, body: JSON.stringify({ ok, recipients: to.length }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
