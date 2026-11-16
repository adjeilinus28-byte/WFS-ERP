import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { Landmark, Plus, ArrowDownLeft, ArrowUpRight, ListChecks, Scale, Pencil, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { PageHeader, StatCard, EmptyState, Badge, Field, Select, useToast } from '../components/ui'
import ExportCsvButton from '../components/ExportCsvButton'
import { money, date } from '../lib/format'
import { at } from '../lib/tr'

// Bank & cash: bank accounts with live balances (opening balance + money in −
// money out from Payments), money in/out by month, per-account transactions,
// and statement reconciliation (checked in the database by reconcile_bank()).
const n = (v) => Number(v || 0)
const today = () => new Date().toISOString().slice(0, 10)
const mask = (no) => (no ? `•••• ${String(no).replace(/\s/g, '').slice(-4)}` : at('number not set'))
const signed = (p) => (p.direction === 'in' ? n(p.amount) : -n(p.amount))
const TIP = { background: 'rgb(var(--navy-700))', border: '1px solid rgb(var(--line) / 0.1)', borderRadius: 10, color: 'rgb(var(--ice))', fontSize: 12 }
const TICK = { fill: 'rgb(var(--ice-faint))', fontSize: 11 }
const METHODS = [['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['mobile_money', 'Mobile money'], ['card', 'Card']]

function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-white/10 bg-navy-800 p-6 shadow-pop ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <h3 className="mb-4 font-display text-lg font-bold text-ice">{title}</h3>
        {children}
        <div className="mt-5 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  )
}

function AccountDialog({ initial, glAccounts, orgId, currency, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    name: '', bank_name: '', account_number: '', currency, gl_account_id: '', opening_balance: 0, opening_date: today(), is_active: true,
    ...(initial || {}),
  }))
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!f.name.trim()) { toast.error(at('Give the account a name')); return }
    setBusy(true)
    const body = {
      org_id: orgId, name: f.name.trim(), bank_name: f.bank_name || null, account_number: f.account_number || null,
      currency: f.currency || currency, gl_account_id: f.gl_account_id || null,
      opening_balance: n(f.opening_balance), opening_date: f.opening_date || today(), is_active: !!f.is_active,
    }
    const q = initial?.id ? supabase.from('bank_accounts').update(body).eq('id', initial.id) : supabase.from('bank_accounts').insert(body)
    const { error } = await q
    setBusy(false)
    if (error) toast.error(error.message)
    else { toast.success(initial?.id ? 'Bank account updated' : 'Bank account added'); onSaved() }
  }
  return (
    <Modal title={initial?.id ? at('Edit bank account') : at('New bank account')} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>{at('Cancel')}</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? at('Saving…') : at('Save')}</button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Account name *" span><input className="input" value={f.name} placeholder="e.g. GCB Operating account" onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Bank"><input className="input" value={f.bank_name || ''} placeholder="e.g. GCB Bank" onChange={(e) => set('bank_name', e.target.value)} /></Field>
        <Field label="Account number"><input className="input" value={f.account_number || ''} onChange={(e) => set('account_number', e.target.value)} /></Field>
        <Field label="Currency"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)} options={['GHS', 'USD', 'EUR', 'GBP', 'NGN', 'ZAR']} /></Field>
        <Field label="Ledger account">
          <Select value={f.gl_account_id || ''} onChange={(e) => set('gl_account_id', e.target.value)}
            options={[{ value: '', label: 'Default cash account' }, ...glAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} />
        </Field>
        <Field label="Opening balance"><input className="input" type="number" step="0.01" value={f.opening_balance} onChange={(e) => set('opening_balance', e.target.value)} /></Field>
        <Field label="Opening balance date"><input className="input" type="date" value={f.opening_date || ''} onChange={(e) => set('opening_date', e.target.value)} /></Field>
        {initial?.id && (
          <label className="flex items-center gap-2 text-sm text-ice-dim sm:col-span-2">
            <input type="checkbox" className="h-4 w-4" checked={!!f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> {at('Account is active')}
          </label>
        )}
      </div>
      <p className="mt-3 text-[11px] text-ice-faint">{at('Money in and out is taken from Payments recorded against this account from the opening balance date.')}</p>
    </Modal>
  )
}

function TxnDialog({ accounts, defaultAccount, orgId, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ bank_account_id: defaultAccount || accounts[0]?.id || '', direction: 'out', amount: '', paid_on: today(), method: 'bank_transfer', reference: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!f.bank_account_id) { toast.error(at('Choose a bank account')); return }
    if (!(n(f.amount) > 0)) { toast.error(at('Enter an amount')); return }
    setBusy(true)
    const { error } = await supabase.from('payments').insert({
      org_id: orgId, bank_account_id: f.bank_account_id, direction: f.direction, amount: n(f.amount),
      paid_on: f.paid_on, method: f.method, reference: f.reference || null, notes: f.notes || null,
    })
    setBusy(false)
    if (error) toast.error(error.message)
    else { toast.success('Transaction recorded'); onSaved() }
  }
  return (
    <Modal title={at('Record a bank transaction')} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>{at('Cancel')}</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? at('Saving…') : at('Save')}</button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Bank account" span><Select value={f.bank_account_id} onChange={(e) => set('bank_account_id', e.target.value)} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Type"><Select value={f.direction} translateOptions onChange={(e) => set('direction', e.target.value)} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} /></Field>
        <Field label="Amount"><input className="input" type="number" step="0.01" min="0" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Date"><input className="input" type="date" value={f.paid_on} onChange={(e) => set('paid_on', e.target.value)} /></Field>
        <Field label="Method"><Select value={f.method} translateOptions onChange={(e) => set('method', e.target.value)} options={METHODS.map(([v, l]) => ({ value: v, label: l }))} /></Field>
        <Field label="Reference" span><input className="input" value={f.reference} placeholder={at('e.g. bank charges, cheque no., transfer ref')} onChange={(e) => set('reference', e.target.value)} /></Field>
        <Field label="Notes" span><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-[11px] text-ice-faint">{at('Supplier bill payments are recorded from Bills (AP) → Pay; pick the bank account there.')}</p>
    </Modal>
  )
}

function ReconcileDialog({ account, txns, onClose, onSaved }) {
  const toast = useToast()
  const [stDate, setStDate] = useState(today())
  const [stBal, setStBal] = useState('')
  const open = txns.filter((p) => !p.reconciled_at && p.paid_on && p.paid_on <= stDate && p.paid_on >= account.opening_date)
  const [ticked, setTicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const alreadyCleared = txns.filter((p) => p.reconciled_at && p.paid_on <= stDate && p.paid_on >= account.opening_date).reduce((t, p) => t + signed(p), 0)
  const cleared = n(account.opening_balance) + alreadyCleared + open.filter((p) => ticked.has(p.id)).reduce((t, p) => t + signed(p), 0)
  const diff = stBal === '' ? null : +(n(stBal) - cleared).toFixed(2)
  const toggle = (id) => setTicked((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x })
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('reconcile_bank', { p_account: account.id, p_date: stDate, p_balance: n(stBal), p_cleared: [...ticked] })
    setBusy(false)
    if (error) toast.error(error.message)
    else { toast.success('Reconciled'); onSaved() }
  }
  const ccy = account.currency
  return (
    <Modal wide title={`${at('Reconcile')} · ${account.name}`} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>{at('Cancel')}</button>
        <button className="btn-primary" onClick={save} disabled={busy || diff !== 0}>{busy ? at('Saving…') : at('Finish reconciliation')}</button></>}>
      <p className="mb-3 text-xs text-ice-faint">{at('Enter the closing balance from your bank statement, then tick every transaction that appears on it. You can finish when the difference is zero.')}</p>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="Statement date"><input className="input" type="date" value={stDate} onChange={(e) => setStDate(e.target.value)} /></Field>
        <Field label={`${at('Statement closing balance')} (${ccy})`}><input className="input" type="number" step="0.01" value={stBal} onChange={(e) => setStBal(e.target.value)} /></Field>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/[0.04] p-3"><div className="text-[11px] text-ice-faint">{at('Statement')}</div><div className="font-mono text-sm text-ice">{stBal === '' ? '—' : money(n(stBal), ccy)}</div></div>
        <div className="rounded-xl bg-white/[0.04] p-3"><div className="text-[11px] text-ice-faint">{at('Cleared in WFS')}</div><div className="font-mono text-sm text-ice">{money(cleared, ccy)}</div></div>
        <div className={`rounded-xl p-3 ${diff === 0 ? 'bg-ok/10' : 'bg-warn/10'}`}><div className="text-[11px] text-ice-faint">{at('Difference')}</div><div className={`font-mono text-sm ${diff === 0 ? 'text-ok' : 'text-warn'}`}>{diff == null ? '—' : money(diff, ccy)}</div></div>
      </div>
      {open.length === 0 ? <p className="rounded-xl bg-white/[0.03] p-4 text-center text-sm text-ice-faint">{at('No unreconciled transactions up to this date.')}</p> : (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-white/[0.06]">
          <table className="w-full">
            <thead><tr><th className="th w-10" /><th className="th">{at('Date')}</th><th className="th">{at('Reference')}</th><th className="th text-right">{at('In')}</th><th className="th text-right">{at('Out')}</th></tr></thead>
            <tbody>
              {open.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => toggle(p.id)}>
                  <td className="td"><input type="checkbox" className="h-4 w-4" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} aria-label={at('Cleared')} /></td>
                  <td className="td whitespace-nowrap">{date(p.paid_on)}</td>
                  <td className="td">{p.reference || p.notes || '—'}</td>
                  <td className="td text-right font-mono text-ok">{p.direction === 'in' ? money(p.amount, ccy) : ''}</td>
                  <td className="td text-right font-mono">{p.direction !== 'in' ? money(p.amount, ccy) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export default function BankCash() {
  const { activeOrgId, activeOrg } = useAuth()
  const { can } = usePermissions()
  const toast = useToast()
  const canEdit = can('finance', 'edit')
  const ccy = activeOrg?.currency || 'GHS'
  const [accounts, setAccounts] = useState(null)
  const [payments, setPayments] = useState([])
  const [gl, setGl] = useState([])
  const [sel, setSel] = useState(null)               // selected account id, or 'unassigned'
  const [dlg, setDlg] = useState(null)               // { kind: 'account'|'txn'|'reconcile', data }

  const load = useCallback(async () => {
    if (!activeOrgId) return
    const [a, p, g] = await Promise.all([
      supabase.from('bank_accounts').select('*').eq('org_id', activeOrgId).order('created_at'),
      supabase.from('payments').select('*').eq('org_id', activeOrgId).order('paid_on', { ascending: true }),
      supabase.from('gl_accounts').select('id, code, name, account_type').eq('org_id', activeOrgId).eq('account_type', 'asset').order('code'),
    ])
    if (a.error) toast.error(a.error.message)
    setAccounts(a.data || []); setPayments(p.data || []); setGl(g.data || [])
  }, [activeOrgId, toast])
  useEffect(() => { load() }, [load])

  const month = today().slice(0, 7)
  const stats = useMemo(() => {
    const m = {}
    for (const a of accounts || []) {
      const tx = payments.filter((p) => p.bank_account_id === a.id && (!p.paid_on || p.paid_on >= a.opening_date))
      const inM = tx.filter((p) => p.direction === 'in' && p.paid_on?.slice(0, 7) === month).reduce((t, p) => t + n(p.amount), 0)
      const outM = tx.filter((p) => p.direction !== 'in' && p.paid_on?.slice(0, 7) === month).reduce((t, p) => t + n(p.amount), 0)
      m[a.id] = { tx, balance: n(a.opening_balance) + tx.reduce((t, p) => t + signed(p), 0), inM, outM, open: tx.filter((p) => !p.reconciled_at).length }
    }
    return m
  }, [accounts, payments, month])

  if (accounts === null) return <div className="grid h-64 place-items-center text-ice-faint">{at('Loading bank accounts…')}</div>

  const active = accounts.filter((a) => a.is_active)
  const unassigned = payments.filter((p) => !p.bank_account_id)
  const totals = active.reduce((t, a) => ({
    bal: t.bal + (a.currency === ccy ? stats[a.id].balance : 0), inM: t.inM + stats[a.id].inM, outM: t.outM + stats[a.id].outM, open: t.open + stats[a.id].open,
  }), { bal: 0, inM: 0, outM: 0, open: 0 })
  const otherCcy = active.filter((a) => a.currency !== ccy)

  // Money in / out by month, last 6 months, all accounts.
  const now = new Date()
  const flow = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const tx = payments.filter((p) => p.bank_account_id && p.paid_on?.slice(0, 7) === key)
    return { name: d.toLocaleString(undefined, { month: 'short' }), in: tx.filter((p) => p.direction === 'in').reduce((t, p) => t + n(p.amount), 0), out: tx.filter((p) => p.direction !== 'in').reduce((t, p) => t + n(p.amount), 0) }
  })

  const current = sel === 'unassigned' ? null : accounts.find((a) => a.id === sel) || active[0] || null
  const rowsFor = current ? (() => { let run = n(current.opening_balance); return stats[current.id].tx.map((p) => ({ ...p, running: (run += signed(p)) })).reverse() })() : []

  const assign = async (pid, aid) => {
    const { error } = await supabase.from('payments').update({ bank_account_id: aid || null }).eq('id', pid)
    if (error) toast.error(error.message); else { toast.success('Payment linked to account'); load() }
  }

  return (
    <div>
      <PageHeader eyebrow="Finance" title="Bank & cash" sub="Balances, money in and out, and statement reconciliation for every bank account.">
        {canEdit && accounts.length > 0 && <button className="btn-ghost" onClick={() => setDlg({ kind: 'txn' })}><Plus size={15} /> {at('Record transaction')}</button>}
        {canEdit && <button className="btn-primary" onClick={() => setDlg({ kind: 'account' })}><Landmark size={15} /> {at('New bank account')}</button>}
      </PageHeader>

      {accounts.length === 0 ? (
        <EmptyState title="No bank accounts yet" hint="Add your bank accounts with their opening balances. Payments recorded against them then show here as money in and out."
          action={canEdit ? <button className="btn-primary btn-sm" onClick={() => setDlg({ kind: 'account' })}><Plus size={14} /> {at('New bank account')}</button> : null} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
            <StatCard label="Cash and bank" value={money(totals.bal, ccy)} icon={Landmark} sub={otherCcy.length ? `${at('plus')} ${otherCcy.length} ${at('account(s) in other currencies')}` : `${active.length} ${at('active account(s)')}`} />
            <StatCard label="Money in this month" value={money(totals.inM, ccy)} tone="ok" icon={ArrowDownLeft} />
            <StatCard label="Money out this month" value={money(totals.outM, ccy)} tone="warn" icon={ArrowUpRight} />
            <StatCard label="Not yet reconciled" value={totals.open} tone={totals.open ? 'info' : 'ok'} icon={ListChecks} sub={unassigned.length ? `${unassigned.length} ${at('payment(s) not linked to an account')}` : at('transactions')} />
          </div>

          {/* Account cards */}
          <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => {
              const s = stats[a.id]; const on = current?.id === a.id
              return (
                <div key={a.id} role="button" tabIndex={0} onClick={() => setSel(a.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(a.id)}
                  className={`kpi cursor-pointer ${on ? '!border-accent-line ring-1 ring-accent/30' : ''} ${a.is_active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-ice-faint">{a.bank_name || at('Bank')} · {a.currency}</div>
                      <div className="truncate text-sm font-semibold text-ice">{a.name}</div>
                      <div className="text-xs text-ice-faint">{mask(a.account_number)}</div>
                    </div>
                    {canEdit && <button className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice" title={at('Edit')}
                      onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'account', data: a }) }}><Pencil size={14} /></button>}
                  </div>
                  <div className="mt-3 font-display text-[26px] font-bold leading-tight text-ice">{money(s.balance, a.currency)}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    <span className="text-ok">+{money(s.inM, a.currency)}</span>
                    <span className="text-warn">−{money(s.outM, a.currency)}</span>
                    <span className="text-ice-faint">{at('this month')}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                    <span className="text-[11px] text-ice-faint">
                      {a.last_reconciled_on ? <><CheckCircle2 size={11} className="mr-1 inline text-ok" />{at('Reconciled to')} {date(a.last_reconciled_on)}</> : at('Not reconciled yet')}
                    </span>
                    {canEdit && <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'reconcile', data: a }) }}><Scale size={13} /> {at('Reconcile')}</button>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Cash flow */}
          <div className="panel mb-5 p-5 lg:p-6">
            <h2 className="font-display text-[17px] font-bold text-ice">{at('Cash flow')}</h2>
            <p className="mb-3 text-xs text-ice-faint">{at('Money in and out of all bank accounts, last 6 months')}</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={flow} margin={{ left: -10 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line) / 0.06)" vertical={false} />
                <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} width={70} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                <Tooltip contentStyle={TIP} cursor={{ fill: 'rgb(var(--wash) / 0.04)' }} formatter={(v, k) => [money(v, ccy), k === 'in' ? at('Money in') : at('Money out')]} />
                <Legend formatter={(k) => (k === 'in' ? at('Money in') : at('Money out'))} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="in" fill="rgb(var(--ok))" radius={[6, 6, 0, 0]} maxBarSize={40} />
                <Bar dataKey="out" fill="rgb(var(--warn))" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Transactions */}
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-3">
              <div className="tabs">
                {accounts.map((a) => <button key={a.id} className={`tab ${current?.id === a.id && sel !== 'unassigned' ? 'tab-on' : ''}`} onClick={() => setSel(a.id)}>{a.name}</button>)}
                {unassigned.length > 0 && <button className={`tab ${sel === 'unassigned' ? 'tab-on' : ''}`} onClick={() => setSel('unassigned')}>{at('Not linked')} · {unassigned.length}</button>}
              </div>
              {current && sel !== 'unassigned' && (
                <div className="ml-auto"><ExportCsvButton name={`bank-${current.name}`} rows={rowsFor}
                  columns={[['paid_on', 'Date'], ['reference', 'Reference'], ['direction', 'Direction'], ['amount', 'Amount'], ['running', 'Balance'], ['method', 'Method'], ['reconciled_at', 'Reconciled']]} /></div>
              )}
            </div>
            {sel === 'unassigned' ? (
              <div className="overflow-x-auto">
                <p className="px-4 pt-3 text-xs text-ice-faint">{at('These payments were recorded without a bank account. Link each one so it counts in the right balance.')}</p>
                <table className="w-full">
                  <thead><tr><th className="th">{at('Date')}</th><th className="th">{at('Reference')}</th><th className="th text-right">{at('Amount')}</th><th className="th">{at('Bank account')}</th></tr></thead>
                  <tbody>{unassigned.slice().reverse().map((p) => (
                    <tr key={p.id}>
                      <td className="td whitespace-nowrap">{date(p.paid_on)}</td>
                      <td className="td">{p.reference || p.notes || '—'} <Badge tone={p.direction === 'in' ? 'ok' : 'mute'}>{p.direction === 'in' ? at('in') : at('out')}</Badge></td>
                      <td className="td text-right font-mono">{money(p.amount, ccy)}</td>
                      <td className="td w-56">{canEdit
                        ? <Select value="" onChange={(e) => assign(p.id, e.target.value)} options={[{ value: '', label: 'Choose account…' }, ...active.map((a) => ({ value: a.id, label: a.name }))]} />
                        : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : current && rowsFor.length === 0 ? (
              <div className="p-8 text-center text-sm text-ice-faint">{at('No transactions on this account since the opening balance date.')}</div>
            ) : current && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className="th">{at('Date')}</th><th className="th">{at('Reference')}</th>
                    <th className="th text-right">{at('In')}</th><th className="th text-right">{at('Out')}</th>
                    <th className="th text-right">{at('Balance')}</th><th className="th">{at('Status')}</th>
                  </tr></thead>
                  <tbody>{rowsFor.map((p) => (
                    <tr key={p.id}>
                      <td className="td whitespace-nowrap">{date(p.paid_on)}</td>
                      <td className="td">{p.reference || p.notes || '—'}{p.bill_id && <span className="ml-1.5 text-xs text-ice-faint">· {at('bill payment')}</span>}{p.invoice_id && <span className="ml-1.5 text-xs text-ice-faint">· {at('customer receipt')}</span>}</td>
                      <td className="td text-right font-mono text-ok">{p.direction === 'in' ? money(p.amount, current.currency) : ''}</td>
                      <td className="td text-right font-mono">{p.direction !== 'in' ? money(p.amount, current.currency) : ''}</td>
                      <td className="td text-right font-mono text-ice-dim">{money(p.running, current.currency)}</td>
                      <td className="td">{p.reconciled_at ? <Badge tone="ok">{at('reconciled')}</Badge> : <Badge>{at('open')}</Badge>}</td>
                    </tr>
                  ))}
                  <tr><td className="td text-ice-faint" colSpan={4}>{at('Opening balance')} · {date(current.opening_date)}</td><td className="td text-right font-mono text-ice-dim">{money(current.opening_balance, current.currency)}</td><td className="td" /></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {dlg?.kind === 'account' && <AccountDialog initial={dlg.data} glAccounts={gl} orgId={activeOrgId} currency={ccy} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load() }} />}
      {dlg?.kind === 'txn' && <TxnDialog accounts={active} defaultAccount={current?.id} orgId={activeOrgId} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load() }} />}
      {dlg?.kind === 'reconcile' && <ReconcileDialog account={dlg.data} txns={stats[dlg.data.id]?.tx || []} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load() }} />}
    </div>
  )
}
