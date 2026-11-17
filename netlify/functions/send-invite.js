// Sends a team-invitation email via Brevo. Best-effort: the Team page shows the
// invite link regardless, so email is a convenience, not a dependency.
// POST { org_id, token }
// Caller must be signed in as an owner or admin of org_id (the same rule as
// create_invite). The recipient, role and link all come from the pending
// invitation row, never from the request, so this cannot be used to email an
// arbitrary address or link.
const { admin, sendBrevo, shell, esc, json, requireMember } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { org_id, token } = body

  try {
    const sb = admin()
    const auth = await requireMember(event, org_id, { sb, roles: ['owner', 'admin'] })
    if (auth.error) return auth.error
    if (!token) return json(400, { error: 'token required' })

    const { data: org } = await sb.from('organizations').select('id, name, logo_url, accent_color').eq('id', org_id).maybeSingle()
    if (!org) return json(404, { error: 'organization not found' })
    const { data: inv } = await sb.from('org_invitations').select('email, role, status, expires_at')
      .eq('token', token).eq('org_id', org_id).maybeSingle()
    if (!inv || inv.status !== 'pending') return json(404, { error: 'invitation not found' })

    const h = event.headers || {}
    const base = String(process.env.URL || h.origin || h.Origin || '').replace(/\/$/, '')
    const link = `${base}/invite/${encodeURIComponent(token)}`

    const html = shell(org, org.accent_color, 'Team invitation', `
      <p>You've been invited to join <strong>${esc(org.name)}</strong> on WFS Enterprise${inv.role ? ` as <strong>${esc(inv.role)}</strong>` : ''}.</p>
      <p style="margin:20px 0">
        <a href="${esc(link)}" style="background:#F59E0B;color:#080C16;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block">Accept invitation</a>
      </p>
      <p style="color:#64748B;font-size:12px">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
      <p style="color:#64748B;font-size:12px">Sign in with <strong>${esc(inv.email)}</strong> to accept. This link expires in 7 days.</p>
    `)

    const ok = await sendBrevo({ to: inv.email, subject: `You're invited to ${org.name}`, html })
    return json(ok ? 200 : 502, { ok })
  } catch (e) {
    console.error('[send-invite]', e)
    return json(500, { error: 'error' })
  }
}
