// ============================================================================
//  Sends a password-reset (recovery) link to a member. The OWNER never sees or
//  sets the member's password — the member sets their own via the link. This is
//  the only safe way for an admin to help with a password.
//
//  Security: verifies the CALLER's JWT, confirms they are an owner/admin of the
//  target org, and that the target user is actually a member of that org. Then
//  uses the Supabase admin API (service role) to generate a recovery link.
//
//  Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Email optional (Brevo) — the
//  link is also returned so the admin can copy it if email isn't configured.
// ============================================================================
const { createClient } = require('@supabase/supabase-js')
let sendBrevo, shell
try { ({ sendBrevo, shell } = require('./_lib')) } catch { /* email optional */ }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return { statusCode: 500, body: 'Server not configured' }

  let body
  try { body = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Bad JSON' } }
  const { org_id, target_user_id, redirect_to } = body
  if (!org_id || !target_user_id) return { statusCode: 400, body: 'Missing org_id or target_user_id' }

  // 1) Identify the caller from their bearer token.
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return { statusCode: 401, body: 'Not authenticated' }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller, error: cErr } = await admin.auth.getUser(jwt)
  if (cErr || !caller?.user) return { statusCode: 401, body: 'Invalid session' }
  const callerId = caller.user.id

  // 2) Confirm caller is owner/admin of this org.
  const { data: callerMem } = await admin
    .from('org_members').select('role').eq('org_id', org_id).eq('user_id', callerId).maybeSingle()
  if (!callerMem || !['owner', 'admin'].includes(callerMem.role)) {
    return { statusCode: 403, body: 'Only owners and admins can reset passwords' }
  }

  // 3) Confirm the target is a member of this org, and get their email.
  const { data: targetMem } = await admin
    .from('org_members').select('email').eq('org_id', org_id).eq('user_id', target_user_id).maybeSingle()
  if (!targetMem) return { statusCode: 404, body: 'That member is not in this organization' }

  // Prefer the auth email of record.
  const { data: targetUser } = await admin.auth.admin.getUserById(target_user_id)
  const email = targetUser?.user?.email || targetMem.email
  if (!email) return { statusCode: 404, body: 'No email on file for that member' }

  // 4) Generate a recovery link via the admin API.
  const { data: linkData, error: lErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: redirect_to ? { redirectTo: redirect_to } : undefined,
  })
  if (lErr) {
    console.error('[reset] generateLink failed', lErr)
    return { statusCode: 500, body: 'Could not generate reset link' }
  }
  const actionLink = linkData?.properties?.action_link || null

  // 5) Best-effort email; return the link regardless so the admin can copy it.
  let emailed = false
  if (sendBrevo && shell && actionLink) {
    try {
      const html = shell('WFS Enterprise', '#F59E0B', 'Reset your password', `
        <p>A password reset was requested for your WFS Enterprise account.</p>
        <p style="margin:20px 0">
          <a href="${actionLink}" style="background:#F59E0B;color:#080C16;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block">Set a new password</a>
        </p>
        <p style="color:#64748B;font-size:12px">If you didn't request this, you can ignore this email.</p>
      `)
      await sendBrevo({ to: email, subject: 'Reset your WFS Enterprise password', html })
      emailed = true
    } catch (e) { console.error('[reset] email failed', e) }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, emailed, email, link: actionLink }),
  }
}
