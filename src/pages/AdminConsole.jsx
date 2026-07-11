import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, Badge, EmptyState, useToast, Field, Select } from '../components/ui'
import { money, date } from '../lib/format'
import { at } from '../lib/tr'
import { Building2, Users, DollarSign, Settings2, Plus, Check, X, Ban, RotateCcw, Gift } from 'lucide-react'

// Platform-owner cockpit. Every mutation calls an is_platform_owner()-gated RPC,
// so this UI gate is defence-in-depth. Non-owners never see the nav entry and,
// if they hit the route directly, get a no-access screen (and the RPCs would
// refuse anyway).
const SUB_TONE = { active: 'ok', trial: 'accent', expired: 'bad', comped: 'info' }

export default function AdminConsole() {
  const { isOwner } = useAuth()
  const toast = useToast()
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [tab, setTab] = useState('orgs')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: o }, { data: s }] = await Promise.all([
        supabase.rpc('admin_list_orgs'),
        supabase.from('platform_settings').select('*').eq('id', 1).single(),
      ])
      setOrgs(o || [])
      setSettings(s || null)
    } catch (e) { toast.error(e.message || 'Load failed') }
    finally { setLoading(false) }
  }, [toast])

  useEffect(() => { if (isOwner) load() }, [isOwner, load])

  if (!isOwner) {
    return <div className="pt-10"><EmptyState title={at('No access')} hint={at('This area is for platform administrators only.')} /></div>
  }

  const act = async (fn, args, okMsg) => {
    try {
      const { error } = await supabase.rpc(fn, args)
      if (error) throw error
      toast.success(at(okMsg))
      await load()
    } catch (e) { toast.error(e.message || 'Action failed') }
  }

  const totalMRR = orgs.filter((o) => o.subscription_status === 'active')
    .reduce((s) => s + Number(settings?.monthly_price || 0), 0)
  const activeCount = orgs.filter((o) => o.subscription_status === 'active').length
  const trialCount = orgs.filter((o) => o.subscription_status === 'trial').length

  return (
    <div>
      <PageHeader eyebrow={at('Platform')} title={at('Admin console')} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={at('Organizations')} value={orgs.length} icon={Building2} />
        <StatCard label={at('Active')} value={activeCount} icon={Check} tone="ok" />
        <StatCard label={at('On trial')} value={trialCount} icon={Users} tone="accent" />
        <StatCard label={at('Est. monthly')} value={money(totalMRR, settings?.currency || 'USD')} icon={DollarSign} />
      </div>

      <div className="mb-4 flex gap-1.5">
        {[['orgs', at('Tenants')], ['settings', at('Platform settings')]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === k ? 'bg-accent text-navy' : 'bg-white/[0.04] text-ice-dim hover:text-ice'}`}>{l}</button>
        ))}
      </div>

      {tab === 'orgs' ? (
        loading ? <div className="panel p-8 text-center text-sm text-ice-faint">{at('Loading…')}</div>
        : orgs.length === 0 ? <EmptyState title={at('No organizations yet')} />
        : (
          <div className="space-y-2">
            {orgs.map((o) => <OrgRow key={o.id} o={o} act={act} />)}
          </div>
        )
      ) : (
        <PlatformSettings settings={settings} onSaved={load} />
      )}
    </div>
  )
}

function OrgRow({ o, act }) {
  const [open, setOpen] = useState(false)
  const ends = o.subscription_status === 'trial' ? o.trial_ends_at : o.subscription_ends_at
  const daysLeft = ends ? Math.ceil((new Date(ends) - new Date()) / 86400000) : null
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-accent"><Building2 size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ice">{o.name}</span>
            <Badge tone={SUB_TONE[o.subscription_status] || 'info'}>{at(o.subscription_status)}</Badge>
            {o.status === 'suspended' && <Badge tone="bad">{at('suspended')}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-ice-faint">
            {o.industry} · {o.member_count} {at('members')} · {o.currency}
            {ends && <> · {daysLeft > 0 ? `${daysLeft} ${at('days left')}` : at('ended')} ({date(ends)})</>}
            {Number(o.total_paid) > 0 && <> · {at('paid')} {money(o.total_paid, o.currency)}</>}
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="shrink-0 rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-ice-dim hover:text-ice">
          {at('Manage')}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
          <button onClick={() => act('admin_extend_org', { p_org: o.id, p_months: 1 }, 'Extended 1 month')}
            className="flex items-center gap-1 rounded-lg bg-ok/15 px-3 py-1.5 text-xs text-ok hover:bg-ok/25"><Plus size={12} /> {at('+1 month')}</button>
          <button onClick={() => act('admin_extend_org', { p_org: o.id, p_months: 12 }, 'Extended 12 months')}
            className="flex items-center gap-1 rounded-lg bg-ok/15 px-3 py-1.5 text-xs text-ok hover:bg-ok/25"><Plus size={12} /> {at('+12 months')}</button>
          <button onClick={() => act('admin_set_org_plan', { p_org: o.id, p_status: 'comped', p_ends: null }, 'Comped')}
            className="flex items-center gap-1 rounded-lg bg-info/15 px-3 py-1.5 text-xs text-info hover:bg-info/25"><Gift size={12} /> {at('Comp (free)')}</button>
          {o.status === 'suspended' ? (
            <button onClick={() => act('admin_set_org_status', { p_org: o.id, p_status: 'active' }, 'Reactivated')}
              className="flex items-center gap-1 rounded-lg bg-ok/15 px-3 py-1.5 text-xs text-ok hover:bg-ok/25"><RotateCcw size={12} /> {at('Reactivate')}</button>
          ) : (
            <button onClick={() => act('admin_set_org_status', { p_org: o.id, p_status: 'suspended' }, 'Suspended')}
              className="flex items-center gap-1 rounded-lg bg-bad/15 px-3 py-1.5 text-xs text-bad hover:bg-bad/25"><Ban size={12} /> {at('Suspend')}</button>
          )}
        </div>
      )}
    </div>
  )
}

function PlatformSettings({ settings, onSaved }) {
  const toast = useToast()
  const [price, setPrice] = useState(settings?.monthly_price ?? 0)
  const [currency, setCurrency] = useState(settings?.currency || 'USD')
  const [trialDays, setTrialDays] = useState(settings?.trial_days ?? 30)
  const [pubKey, setPubKey] = useState(settings?.paystack_public_key || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('admin_update_settings', {
        p_price: Number(price), p_currency: currency,
        p_trial_days: Number(trialDays), p_paystack_public_key: pubKey || null,
      })
      if (error) throw error
      toast.success(at('Settings saved'))
      onSaved && onSaved()
    } catch (e) { toast.error(e.message || 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="panel max-w-lg space-y-4 p-6">
      <div className="grid grid-cols-2 gap-4">
        <Field label={at('Monthly price')}>
          <input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label={at('Currency')}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}
            options={[['USD', 'USD'], ['GHS', 'GHS'], ['NGN', 'NGN'], ['ZAR', 'ZAR']].map(([v, l]) => ({ value: v, label: l }))} />
        </Field>
      </div>
      <Field label={at('Free trial length (days)')}>
        <input className="input" type="number" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
      </Field>
      <Field label={at('Paystack public key')}>
        <input className="input font-mono text-xs" value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="pk_live_…" />
      </Field>
      <button onClick={save} disabled={busy} className="btn-primary w-full">
        <Settings2 size={16} /> {busy ? at('Saving…') : at('Save settings')}
      </button>
      <p className="text-[11px] text-ice-faint">{at('Price changes apply to new subscriptions and renewals. Existing paid periods are unchanged.')}</p>
    </div>
  )
}
