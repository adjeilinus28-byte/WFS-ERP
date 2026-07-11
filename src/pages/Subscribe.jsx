import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { money, date } from '../lib/format'
import { at } from '../lib/tr'
import { WFSMark } from '../components/Brand'
import { ShieldCheck, CreditCard, AlertCircle, Clock, LogOut } from 'lucide-react'

// Paystack inline checkout. CRITICAL: callback/onClose MUST be plain functions,
// not async arrows — Paystack's validator rejects arrows ("Attribute callback
// must be a valid function"). Async work lives in handlePaymentSuccess().
export default function Subscribe() {
  const { user, activeOrg, activeOrgId, reloadMemberships, signOut } = useAuth()
  const { settings, state, isTrial, daysLeft } = useSubscription()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState([])

  const price = settings?.monthly_price ?? 0
  const currency = settings?.currency || activeOrg?.currency || 'USD'
  const pubKey = settings?.paystack_public_key || import.meta.env.VITE_PAYSTACK_PUBLIC_KEY
  const isExpired = state === 'expired'

  useEffect(() => {
    if (!window.PaystackPop) {
      const s = document.createElement('script')
      s.src = 'https://js.paystack.co/v1/inline.js'
      document.head.appendChild(s)
    }
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId])

  async function loadHistory() {
    if (!activeOrgId) return
    const { data } = await supabase.from('subscription_payments')
      .select('*').eq('org_id', activeOrgId).order('paid_at', { ascending: false }).limit(10)
    setHistory(data || [])
  }

  // Async work extracted from the Paystack callback (which must stay a plain fn).
  // The Paystack WEBHOOK is the source of truth — it verifies the charge with
  // Paystack's secret key server-side and calls apply_subscription_payment().
  // We never extend the subscription from the client (that would let anyone
  // grant themselves access without paying). Here we just poll for the webhook
  // to land, then reload so the gate opens.
  async function handlePaymentSuccess(reference) {
    setError('')
    // Poll subscription_payments for the reference the webhook records (up to ~20s).
    for (let i = 0; i < 10; i++) {
      const { data } = await supabase.from('subscription_payments')
        .select('id').eq('reference', reference).maybeSingle()
      if (data) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    await reloadMemberships()
    await loadHistory()
    setBusy(false)
  }

  function startPayment() {
    setError('')
    if (!pubKey) { setError(at('Payment is not configured yet. Please try again later.')); return }
    if (!window.PaystackPop) { setError(at('Payment is still loading — try again in a moment.')); return }
    if (!price || price <= 0) { setError(at('No subscription price is set. Contact support.')); return }
    setBusy(true)

    const reference = `WFS-${activeOrgId?.slice(0, 8)}-${Date.now()}`

    const handler = window.PaystackPop.setup({
      key: pubKey,
      email: user?.email,
      amount: Math.round(price * 100),   // Paystack uses the minor unit (pesewas/kobo/cents)
      currency,
      ref: reference,
      label: `${activeOrg?.org_name || 'WFS Enterprise'} — WorkFlow Solutions`,
      channels: ['card', 'mobile_money', 'bank'],
      metadata: {
        org_id: activeOrgId,
        org_name: activeOrg?.org_name,
        months: 1,
        custom_fields: [
          { display_name: 'Organization', variable_name: 'org_name', value: activeOrg?.org_name || '' },
        ],
      },
      callback: function (response) {
        // plain function (no async) — hand off to the async helper
        handlePaymentSuccess(response.reference)
      },
      onClose: function () {
        setBusy(false)
        setError(at('Payment window closed. You can try again anytime.'))
      },
    })
    handler.openIframe()
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <WFSMark size={44} />
          {isExpired ? (
            <>
              <div className="mt-4 grid h-12 w-12 place-items-center rounded-full bg-bad/15">
                <AlertCircle size={24} className="text-bad" />
              </div>
              <h1 className="mt-3 font-display text-2xl font-extrabold text-ice">{at('Subscription expired')}</h1>
              <p className="mt-2 text-sm text-ice-faint">{at('Your access is paused. Renew to continue using WFS Enterprise.')}</p>
            </>
          ) : (
            <>
              <h1 className="mt-4 font-display text-2xl font-extrabold text-ice">{at('Subscribe to WFS Enterprise')}</h1>
              <p className="mt-2 text-sm text-ice-faint">
                {isTrial
                  ? `${at('Your free trial has')} ${daysLeft} ${at('days left')}. ${at('Subscribe anytime to keep your workspace active.')}`
                  : at('Keep your workspace active with a monthly subscription.')}
              </p>
            </>
          )}
        </div>

        <div className="panel p-6">
          <div className="flex items-baseline justify-between border-b border-white/[0.08] pb-4">
            <span className="text-sm text-ice-dim">{activeOrg?.org_name}</span>
            <span className="font-display text-2xl font-extrabold text-ice">
              {money(price, currency)}<span className="text-sm font-normal text-ice-faint">/{at('month')}</span>
            </span>
          </div>

          <ul className="my-5 space-y-2 text-sm text-ice-dim">
            {[at('All modules & unlimited records'), at('Every team member on your workspace'), at('Offline-ready, auto-updating'), at('Priority support')].map((f) => (
              <li key={f} className="flex items-center gap-2"><ShieldCheck size={15} className="text-ok" /> {f}</li>
            ))}
          </ul>

          {error && <p className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

          <button onClick={startPayment} disabled={busy} className="btn-primary w-full">
            <CreditCard size={16} /> {busy ? at('Opening…') : `${at('Pay')} ${money(price, currency)} — ${at('Subscribe')}`}
          </button>
          <p className="mt-3 text-center text-[11px] text-ice-faint">{at('Secure payment via Paystack — card, mobile money, or bank.')}</p>
        </div>

        {history.length > 0 && (
          <div className="mt-6">
            <div className="eyebrow mb-2">{at('Payment history')}</div>
            <div className="space-y-1.5">
              {history.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                  <span className="flex items-center gap-2 text-ice-dim"><Clock size={12} /> {date(p.paid_at)}</span>
                  <span className="font-mono text-ice">{money(p.amount, p.currency)}</span>
                  <span className={p.status === 'success' ? 'text-ok' : 'text-ice-faint'}>{at(p.status)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-ice-faint">
          {at('Signed in as')} <span className="text-ice">{user?.email}</span> ·{' '}
          <button onClick={signOut} className="inline-flex items-center gap-1 text-accent hover:underline"><LogOut size={11} /> {at('Sign out')}</button>
        </p>
      </div>
    </div>
  )
}
