// Sends a team-invitation email via Brevo. Best-effort: the Team page shows the
// invite link regardless, so email is a convenience, not a dependency.
const { sendBrevo, shell } = require('./_lib')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
  let body
  try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Bad JSON' } }
  const { email, link, org, role } = body
  if (!email || !link) return { statusCode: 400, body: 'Missing email or link' }

  const html = shell(org || 'WFS Enterprise', '#F59E0B', 'Team invitation', `
    <p>You've been invited to join <strong>${org || 'a workspace'}</strong> on WFS Enterprise${role ? ` as <strong>${role}</strong>` : ''}.</p>
    <p style="margin:20px 0">
      <a href="${link}" style="background:#F59E0B;color:#080C16;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block">Accept invitation</a>
    </p>
    <p style="color:#64748B;font-size:12px">Or paste this link into your browser:<br><span style="word-break:break-all">${link}</span></p>
    <p style="color:#64748B;font-size:12px">Sign in with <strong>${email}</strong> to accept. This link expires in 7 days.</p>
  `)

  try {
    const ok = await sendBrevo({ to: email, subject: `You're invited to ${org || 'WFS Enterprise'}`, html })
    return { statusCode: ok ? 200 : 502, body: ok ? 'sent' : 'brevo failed' }
  } catch (e) {
    console.error('[send-invite]', e)
    return { statusCode: 500, body: 'error' }
  }
}
