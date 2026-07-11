// ============================================================================
//  Paystack webhook — server-side source of truth for subscriptions.
//  Verifies the event signature with PAYSTACK_SECRET_KEY, then calls the
//  SECURITY DEFINER RPC apply_subscription_payment() with the service role so
//  the org's subscription is extended exactly once (idempotent on reference).
//
//  Netlify env vars required:
//    PAYSTACK_SECRET_KEY            sk_live_… (server-only)
//    SUPABASE_URL                   https://<ref>.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY      service_role key (server-only)
//  Paystack dashboard → Settings → Webhooks:
//    https://wfs-erp.netlify.app/.netlify/functions/paystack-webhook
// ============================================================================
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return { statusCode: 500, body: 'Server not configured' }

  // 1) Verify the signature so only genuine Paystack events are trusted.
  const signature = event.headers['x-paystack-signature'] || event.headers['X-Paystack-Signature']
  const hash = crypto.createHmac('sha512', secret).update(event.body).digest('hex')
  if (hash !== signature) {
    return { statusCode: 401, body: 'Invalid signature' }
  }

  let payload
  try { payload = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Bad JSON' } }

  // 2) Only act on successful charges.
  if (payload.event !== 'charge.success') {
    return { statusCode: 200, body: 'Ignored' }
  }

  const data = payload.data || {}
  const reference = data.reference
  const amount = (data.amount || 0) / 100                 // minor unit → major
  const currency = data.currency || 'USD'
  const meta = data.metadata || {}
  const orgId = meta.org_id
  const months = parseInt(meta.months, 10) || 1
  const paidBy = data.customer?.email || null

  if (!orgId || !reference) {
    return { statusCode: 200, body: 'Missing org/reference' }
  }

  // 3) Apply via the SECURITY DEFINER RPC using the service role (bypasses RLS,
  //    idempotent on reference so retries/duplicates are safe).
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { error } = await supabase.rpc('apply_subscription_payment', {
    p_org: orgId, p_amount: amount, p_currency: currency,
    p_reference: reference, p_months: months, p_paid_by: paidBy,
  })

  if (error) {
    console.error('[paystack-webhook] apply failed', error)
    return { statusCode: 500, body: 'Apply failed' }
  }
  return { statusCode: 200, body: 'OK' }
}
