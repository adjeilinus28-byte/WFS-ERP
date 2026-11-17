// Sends a News Flash announcement by email. POST { org_id, news_id }
// Recipient = department head or supervisor (per notify_target); CC = that
// department's workers (or all workers if the item is org-wide).
// Caller must be signed in as an owner, admin or manager of org_id (the same
// roles the database lets write News Flash); the item is only looked up inside
// that workspace, and everything typed is HTML-escaped.
const { admin, sendBrevo, shell, esc, safeColor, safeUrl, json, requireMember } = require('./_lib')

const CAT_LABEL = { announcement: 'Announcement', campaign: 'Campaign', event: 'Event', alert: 'Alert', policy: 'Policy' }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  try {
    const { org_id, news_id } = JSON.parse(event.body || '{}')
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb, roles: ['owner', 'admin', 'manager'] })
    if (auth.error) return auth.error
    if (!news_id) return json(400, { error: 'org_id and news_id required' })
    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: n } = await sb.from('news_flash').select('*').eq('id', news_id).eq('org_id', org_id).maybeSingle()
    if (!n) return json(404, { error: 'announcement not found' })
    if (!n.notify_target) return json(200, { ok: false, note: 'email not requested' })

    // Primary recipient — dept head or supervisor
    let to = []
    if (n.department) {
      const { data: dept } = await sb.from('departments').select('head_email, supervisor_email').eq('org_id', org_id).eq('name', n.department).maybeSingle()
      const addr = n.notify_target === 'supervisor' ? dept?.supervisor_email : dept?.head_email
      if (addr) to = [addr]
    }

    // Workers to CC — the department's employees (or everyone if org-wide)
    let empQ = sb.from('employees').select('email, department').eq('org_id', org_id).not('email', 'is', null)
    if (n.department) empQ = empQ.eq('department', n.department)
    const { data: emps } = await empQ
    const cc = [...new Set((emps || []).map((e) => e.email).filter((e) => e && !to.includes(e)))]

    // If no primary recipient resolved, promote the first worker so it still sends
    if (to.length === 0) { if (cc.length) { to = [cc.shift()] } else return json(200, { ok: false, note: 'no recipients' }) }

    const cat = CAT_LABEL[n.category] || 'Announcement'
    const scope = n.department ? `${n.department} department` : 'All staff'
    const accent = safeColor(org.accent_color)
    const link = safeUrl(n.link_url)
    const body = `
      <p style="margin:0 0 4px"><span style="display:inline-block;background:${accent}22;color:${accent};padding:2px 10px;border-radius:20px;font-size:12px;font-weight:bold">${esc(cat)}</span>
      <span style="color:#6b7280;font-size:12px;margin-left:6px">${esc(scope)}</span></p>
      <h2 style="margin:8px 0">${esc(n.title)}</h2>
      ${n.body ? `<p style="font-size:15px;line-height:1.6">${esc(n.body)}</p>` : ''}
      ${link ? `<p><a href="${link}" style="color:${accent};font-weight:bold">${esc(n.link_label || 'Learn more')}</a></p>` : ''}
      ${n.priority === 'high' ? '<p style="color:#b91c1c;font-weight:bold;font-size:13px">Marked important</p>' : ''}`

    const ok = await sendBrevo({ to, cc, subject: `[${org.name}] ${cat}: ${n.title}`, html: shell(org, org.accent_color, 'Announcement', body) })
    await sb.from('news_flash').update({ emailed_at: new Date().toISOString() }).eq('id', news_id).eq('org_id', org_id)
    await sb.from('notification_log').insert({ org_id, alert_type: 'news_flash', subject: n.title, recipients: [...to, ...cc], status: ok ? 'sent' : 'failed' })
    return json(200, { ok, to: to.length, cc: cc.length })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
