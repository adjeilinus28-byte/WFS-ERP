import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, Line, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useTable } from '../hooks/useTable'
import { PageHeader, StatCard, Badge, Field, Select, useToast, EmptyState } from '../components/ui'
import { money, date, num } from '../lib/format'
import { businessMonthKey, businessMonthLabel, businessMonthKeyOffset } from '../lib/period'
import {
  aggregateTrialBalance, trialBalanceTotals, incomeStatement, balanceSheet, cashFlow,
  ratios, ratioTone, fiscalYearOf, periodsInFiscalYear, periodFilterList } from '../lib/accounting'
import {
  Scale, BookOpen, TrendingUp, Landmark, RefreshCw, Plus, X, Check, AlertTriangle,
  FileSpreadsheet, Activity, Download, Lock,
} from 'lucide-react'

const CARD = { background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }
const TONE_HEX = { ok: '#16a34a', warn: '#F59E0B', bad: '#dc2626', mute: '#475569' }

function Tabs({ tab, setTab }) {
  const items = [
    ['overview', 'Analysis'], ['balance', 'Balance Sheet'], ['income', 'Income Statement'],
    ['cash', 'Cash Flow'], ['trial', 'Trial Balance'], ['journal', 'Journal'], ['coa', 'Chart of Accounts'],
  ]
  return (
    <div className="mb-5 inline-flex flex-wrap rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>{l}</button>
      ))}
    </div>
  )
}

// Statement line row
const Row = ({ label, value, ccy, bold, indent, tone }) => (
  <div className={`flex items-center justify-between py-1.5 ${indent ? 'pl-4' : ''} ${bold ? 'border-t border-white/10 mt-1 pt-2' : ''}`}>
    <span className={`text-sm ${bold ? 'font-semibold text-ice' : 'text-ice-dim'}`}>{label}</span>
    <span className={`font-mono text-sm ${bold ? 'font-bold text-ice' : 'text-ice/90'} ${tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : ''}`}>{money(value, ccy)}</span>
  </div>
)

export default function Financials() {
  const { activeOrgId, activeOrg } = useAuth()
  const { can } = usePermissions()
  const toast = useToast()
  const ccy = activeOrg?.currency || 'GHS'
  const canPost = can('finance', 'edit')
  const [tab, setTab] = useState('overview')

  const [tb, setTb] = useState([])          // trial_balance rows (per account per period)
  const [accountsList, setAccountsList] = useState([])
  const [entries, setEntries] = useState([])
  const [rules, setRules] = useState([])
  const [fiscal, setFiscal] = useState({ fiscal_year_start_month: 1 })
  const [period, setPeriod] = useState(businessMonthKey(new Date()))
  const [scope, setScope] = useState('period')   // period | fy
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    if (!activeOrgId) return
    setLoading(true)
    const [t, a, e, r, f] = await Promise.all([
      supabase.from('trial_balance').select('*').eq('org_id', activeOrgId),
      supabase.from('gl_accounts').select('*').eq('org_id', activeOrgId).order('code'),
      supabase.from('journal_entries').select('*').eq('org_id', activeOrgId).order('entry_date', { ascending: false }).limit(200),
      supabase.from('posting_rules').select('*').eq('org_id', activeOrgId),
      supabase.from('fiscal_settings').select('*').eq('org_id', activeOrgId).maybeSingle(),
    ])
    setTb(t.data || []); setAccountsList(a.data || []); setEntries(e.data || [])
    setRules(r.data || []); setFiscal(f.data || { fiscal_year_start_month: 1 })
    setLoading(false)
  }
  useEffect(() => { load() }, [activeOrgId])

  const fyStart = fiscal?.fiscal_year_start_month || 1
  // All periods that carry activity, plus the current one
  const allPeriods = useMemo(() => {
    const dataPeriods = tb.map((r) => r.period).filter(Boolean)
    // Full fiscal-year range (so empty months are selectable), unioned with any
    // periods that already carry data, plus the current business month.
    return periodFilterList([...dataPeriods, businessMonthKey(new Date())], period, fyStart)
  }, [tb, period, fyStart])

  // Selected period set: single business month, or the whole fiscal year
  const selectedPeriods = useMemo(() => {
    if (scope === 'fy') return periodsInFiscalYear(fiscalYearOf(period, fyStart), fyStart)
    return [period]
  }, [scope, period, fyStart])

  // Balance sheet is a point in time → cumulative through the END of the selection
  const endPeriod = selectedPeriods[selectedPeriods.length - 1]
  const cumulativeThrough = (endKey) => allPeriods.filter((p) => p <= endKey)
  const priorEnd = (() => {
    const [y, m] = selectedPeriods[0].split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  const periodAccounts = useMemo(() => aggregateTrialBalance(tb, selectedPeriods), [tb, selectedPeriods])
  const cumAccounts = useMemo(() => aggregateTrialBalance(tb, cumulativeThrough(endPeriod)), [tb, allPeriods, endPeriod])
  const priorAccounts = useMemo(() => aggregateTrialBalance(tb, cumulativeThrough(priorEnd)), [tb, allPeriods, priorEnd])

  const isPeriod = useMemo(() => incomeStatement(periodAccounts), [periodAccounts])
  const isCum = useMemo(() => incomeStatement(cumAccounts), [cumAccounts])
  const isPrior = useMemo(() => incomeStatement(priorAccounts), [priorAccounts])
  const bs = useMemo(() => balanceSheet(cumAccounts, isCum.netIncome), [cumAccounts, isCum])
  const bsPrior = useMemo(() => balanceSheet(priorAccounts, isPrior.netIncome), [priorAccounts, isPrior])
  const cf = useMemo(() => cashFlow(priorAccounts, cumAccounts, isPeriod.netIncome), [priorAccounts, cumAccounts, isPeriod])
  const tbTotals = useMemo(() => trialBalanceTotals(periodAccounts), [periodAccounts])
  const ratioList = useMemo(() => ratios(bs, isPeriod), [bs, isPeriod])

  // ── Auto-post source documents ────────────────────────────────────────────
  const acctByCode = useMemo(() => Object.fromEntries(accountsList.map((a) => [a.code, a])), [accountsList])
  const ruleAcct = (role) => acctByCode[rules.find((r) => r.role === role)?.account_code]

  const syncLedger = async () => {
    if (!canPost) return
    setSyncing(true)
    let created = 0, skipped = 0
    try {
      const need = ['ar', 'revenue', 'ap', 'expense', 'inventory', 'materials_expense', 'salaries_expense', 'net_wages_payable', 'ssnit_payable', 'paye_payable', 'employer_ssnit_expense', 'cash']
      for (const r of need) if (!ruleAcct(r)) throw new Error(`Posting rule "${r}" has no matching account. Check the Chart of Accounts.`)
      const accrued = acctByCode['2100']

      const { data: posted } = await supabase.from('journal_entries').select('source_type, source_id').eq('org_id', activeOrgId).not('source_id', 'is', null)
      const done = new Set((posted || []).map((p) => `${p.source_type}:${p.source_id}`))

      const mk = async (source_type, source_id, entry_date, memo, lines) => {
        if (done.has(`${source_type}:${source_id}`)) { skipped++; return }
        const clean = lines.filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
        const d = clean.reduce((s, l) => s + Number(l.debit || 0), 0)
        const c = clean.reduce((s, l) => s + Number(l.credit || 0), 0)
        if (Math.abs(d - c) > 0.01 || d === 0) { skipped++; return }
        const { data: ent, error } = await supabase.from('journal_entries').insert({
          org_id: activeOrgId, entry_date, period: businessMonthKey(entry_date),
          memo, source_type, source_id, entry_no: `${source_type.toUpperCase()}-${String(source_id).slice(0, 8)}`,
        }).select().single()
        if (error) { skipped++; return }
        await supabase.from('journal_lines').insert(clean.map((l) => ({ ...l, org_id: activeOrgId, entry_id: ent.id })))
        const { error: pErr } = await supabase.rpc('post_journal_entry', { p_entry: ent.id })
        if (pErr) { await supabase.from('journal_entries').delete().eq('id', ent.id); skipped++; return }
        created++
      }

      // Invoices → DR Accounts Receivable, CR Revenue
      const { data: invoices } = await supabase.from('invoices').select('*').eq('org_id', activeOrgId).in('status', ['sent', 'approved', 'partial', 'paid', 'overdue'])
      for (const i of invoices || []) {
        const amt = Number(i.total || 0); if (!amt) continue
        await mk('invoice', i.id, i.issue_date || i.created_at?.slice(0, 10), `Invoice ${i.invoice_no || ''}`, [
          { account_id: ruleAcct('ar').id, debit: amt, credit: 0, description: 'Receivable' },
          { account_id: ruleAcct('revenue').id, debit: 0, credit: amt, description: 'Revenue' },
        ])
      }

      // Bills → DR Expense, CR Accounts Payable
      const { data: bills } = await supabase.from('bills').select('*').eq('org_id', activeOrgId).neq('status', 'draft')
      for (const b of bills || []) {
        const amt = Number(b.total || b.amount || 0); if (!amt) continue
        await mk('bill', b.id, b.bill_date || b.created_at?.slice(0, 10), `Bill ${b.bill_no || ''}`, [
          { account_id: ruleAcct('expense').id, debit: amt, credit: 0, description: 'Expense' },
          { account_id: ruleAcct('ap').id, debit: 0, credit: amt, description: 'Payable' },
        ])
      }

      // Payments (outbound, against a bill) → DR AP, CR Cash — settles the payable
      const { data: pmts } = await supabase.from('payments').select('*').eq('org_id', activeOrgId).eq('direction', 'out').not('bill_id', 'is', null)
      for (const p of pmts || []) {
        const amt = Number(p.amount || 0); if (!amt) continue
        await mk('payment', p.id, p.paid_on || p.created_at?.slice(0, 10), `Payment ${p.reference || p.id.slice(0, 8)}`, [
          { account_id: ruleAcct('ap').id, debit: amt, credit: 0, description: 'Settle payable' },
          { account_id: ruleAcct('cash').id, debit: 0, credit: amt, description: 'Cash out' },
        ])
      }

      // Issuance → DR Materials expense, CR Inventory
      const { data: issues } = await supabase.from('issuances').select('*').eq('org_id', activeOrgId)
      for (const s of issues || []) {
        const amt = Number(s.total_cost || 0); if (!amt) continue
        await mk('issuance', s.id, s.issue_date, `Issuance ${s.id.slice(0, 8)}`, [
          { account_id: ruleAcct('materials_expense').id, debit: amt, credit: 0, description: 'Materials issued' },
          { account_id: ruleAcct('inventory').id, debit: 0, credit: amt, description: 'Inventory reduction' },
        ])
      }

      // Payroll → DR Salaries + Employer SSNIT, CR Net wages / SSNIT / PAYE / accruals
      const { data: pays } = await supabase.from('payroll').select('*').eq('org_id', activeOrgId).in('status', ['approved', 'paid'])
      for (const p of pays || []) {
        const gross = Number(p.gross_pay || 0), net = Number(p.net_pay || 0)
        if (!gross) continue
        const ssnitEmp = Number(p.ssnit || 0), ssnitEr = Number(p.ssnit_employer || 0)
        const taxes = Number(p.paye_amount || 0) + Number(p.overtime_tax || 0) + Number(p.bonus_tax || 0)
        const rest = +(gross - net - ssnitEmp - taxes).toFixed(2)   // union dues, rent, loans, other
        const day = (p.period ? `${p.period}-20` : new Date().toISOString().slice(0, 10))
        await mk('payroll', p.id, day, `Payroll ${p.period || ''} — ${p.employee_name || ''}`, [
          { account_id: ruleAcct('salaries_expense').id, debit: gross, credit: 0, description: 'Gross pay' },
          { account_id: ruleAcct('employer_ssnit_expense').id, debit: ssnitEr, credit: 0, description: 'Employer SSNIT' },
          { account_id: ruleAcct('net_wages_payable').id, debit: 0, credit: net, description: 'Net wages' },
          { account_id: ruleAcct('ssnit_payable').id, debit: 0, credit: +(ssnitEmp + ssnitEr).toFixed(2), description: 'SSNIT payable' },
          { account_id: ruleAcct('paye_payable').id, debit: 0, credit: taxes, description: 'PAYE & other taxes' },
          ...(rest > 0.01 && accrued ? [{ account_id: accrued.id, debit: 0, credit: rest, description: 'Other deductions' }] : []),
        ])
      }

      toast.success(`Ledger synced — ${created} entries posted, ${skipped} skipped`)
      load()
    } catch (e) { toast.error(e.message) } finally { setSyncing(false) }
  }

  const exportCsv = () => {
    const rows = [['Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance']]
    periodAccounts.forEach((a) => rows.push([a.code, `"${a.name}"`, a.account_type, a.total_debit, a.total_credit, a.balance]))
    const csv = rows.map((r) => r.join(',')).join('\n')
    const b = new Blob([csv], { type: 'text/csv' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(b)
    link.download = `trial-balance-${endPeriod}.csv`; link.click()
  }

  if (loading) return <div className="grid h-64 place-items-center text-ice-faint">Loading ledger…</div>

  const periodLabel = scope === 'fy' ? `FY ${fiscalYearOf(period, fyStart)}` : businessMonthLabel(period)

  return (
    <div>
      <PageHeader eyebrow="Finance" title="Financial Statements">
        <button className="btn-ghost" onClick={exportCsv}><Download size={15} /> Export</button>
        {canPost && <button className="btn-primary" onClick={syncLedger} disabled={syncing}><RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync ledger'}</button>}
      </PageHeader>

      {/* Period selector */}
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Period:</span>
        <div className="w-44"><Select value={period} onChange={(e) => setPeriod(e.target.value)} options={allPeriods.map((p) => ({ value: p, label: businessMonthLabel(p) }))} /></div>
        <div className="inline-flex rounded-lg border border-white/10 bg-navy/60 p-0.5">
          <button onClick={() => setScope('period')} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${scope === 'period' ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>Month</button>
          <button onClick={() => setScope('fy')} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${scope === 'fy' ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>Fiscal year</button>
        </div>
        <span className="font-mono text-[11px] text-ice-faint">{periodLabel} · business month 21st–20th</span>
        <span className="ml-auto">
          {tbTotals.balanced
            ? <Badge tone="ok"><Check size={11} className="mr-1 inline" />Books balanced</Badge>
            : <Badge tone="bad"><AlertTriangle size={11} className="mr-1 inline" />Out of balance</Badge>}
        </span>
      </div>

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'overview' && <Analysis bs={bs} is={isPeriod} isPrior={isPrior} ratioList={ratioList} ccy={ccy} tb={tb} allPeriods={allPeriods} />}
      {tab === 'balance' && <BalanceSheetView bs={bs} ccy={ccy} label={periodLabel} />}
      {tab === 'income' && <IncomeView is={isPeriod} ccy={ccy} label={periodLabel} />}
      {tab === 'cash' && <CashFlowView cf={cf} ccy={ccy} label={periodLabel} />}
      {tab === 'trial' && <TrialBalanceView accounts={periodAccounts} totals={tbTotals} ccy={ccy} />}
      {tab === 'journal' && <JournalView entries={entries} accounts={accountsList} ccy={ccy} canPost={canPost} onChange={load} />}
      {tab === 'coa' && <ChartOfAccounts accounts={accountsList} onChange={load} />}
    </div>
  )
}

// ── Analysis dashboard ───────────────────────────────────────────────────────
function Analysis({ bs, is, isPrior, ratioList, ccy, tb, allPeriods }) {
  const groups = [...new Set(ratioList.map((r) => r.group))]

  const nowKey = businessMonthKey(new Date())
  const trend = useMemo(() => allPeriods.filter((p) => p <= nowKey).slice(-6).map((p) => {
    const acc = aggregateTrialBalance(tb, [p])
    const s = incomeStatement(acc)
    return { name: businessMonthLabel(p).split(' ')[0], revenue: s.revenue, net: s.netIncome }
  }), [tb, allPeriods, nowKey])

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total assets" value={money(bs.totalAssets, ccy)} icon={Landmark} />
        <StatCard label="Total liabilities" value={money(bs.totalLiabilities, ccy)} icon={Scale} />
        <StatCard label="Equity" value={money(bs.totalEquity, ccy)} tone="ok" icon={TrendingUp} />
        <StatCard label="Net income (period)" value={money(is.netIncome, ccy)} tone={is.netIncome >= 0 ? 'ok' : 'bad'} icon={Activity} />
      </div>

      {!bs.balanced && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-ice">
          <b>Balance sheet does not balance</b> — difference of {money(bs.check, ccy)}. This usually means an entry was posted without an offsetting line, or opening balances were never captured. Review the Trial Balance.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="eyebrow mb-4">Revenue &amp; net income trend</div>
          {trend.length === 0 ? <div className="grid h-56 place-items-center text-sm text-ice-faint">No posted activity yet</div> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CARD} formatter={(v) => money(v, ccy)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="rgb(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="net" name="Net income" stroke="#34D399" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-4">Assets vs liabilities &amp; equity</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={[
              { name: 'Assets', value: bs.totalAssets },
              { name: 'Liabilities', value: bs.totalLiabilities },
              { name: 'Equity', value: bs.totalEquity },
            ]} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CARD} formatter={(v) => money(v, ccy)} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {['#F59E0B', '#F87171', '#34D399'].map((c, i) => <Cell key={i} fill={c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g} className="panel mt-4 p-5">
          <div className="eyebrow mb-3">{g} ratios</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ratioList.filter((r) => r.group === g).map((r) => {
              const tone = ratioTone(r)
              return (
                <div key={r.key} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between">
                    <span className="text-xs text-ice-dim">{r.label}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_HEX[tone] }} />
                  </div>
                  <div className="mt-1 font-display text-xl font-bold" style={{ color: TONE_HEX[tone] }}>
                    {r.value == null ? '—' : r.money ? money(r.value, ccy) : `${r.value}${r.suffix}`}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-ice-faint">{r.hint}</p>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Balance sheet ────────────────────────────────────────────────────────────
function BalanceSheetView({ bs, ccy, label }) {
  const section = (title, list) => (
    <>
      <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">{title}</div>
      {list.length === 0 ? <p className="py-1 text-xs text-ice-faint/60">None</p>
        : list.map((a) => <Row key={a.account_id} label={`${a.code} · ${a.name}${a.is_contra ? ' (contra)' : ''}`} value={a.is_contra ? -a.balance : a.balance} ccy={ccy} indent />)}
    </>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel p-5">
        <div className="mb-1 eyebrow">Assets</div>
        <div className="text-[11px] text-ice-faint">As at end of {label}</div>
        {section('Current assets', bs.currentAssets)}
        <Row label="Total current assets" value={bs.totalCurrentAssets} ccy={ccy} bold />
        {section('Non-current assets', bs.fixedAssets)}
        <Row label="Total non-current assets" value={bs.totalFixedAssets} ccy={ccy} bold />
        <div className="mt-3 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2">
          <span className="font-semibold text-ice">TOTAL ASSETS</span>
          <span className="font-display text-lg font-bold text-accent">{money(bs.totalAssets, ccy)}</span>
        </div>
      </div>

      <div className="panel p-5">
        <div className="mb-1 eyebrow">Liabilities &amp; Equity</div>
        <div className="text-[11px] text-ice-faint">As at end of {label}</div>
        {section('Current liabilities', bs.currentLiabilities)}
        <Row label="Total current liabilities" value={bs.totalCurrentLiabilities} ccy={ccy} bold />
        {section('Long-term liabilities', bs.longTermLiabilities)}
        <Row label="Total liabilities" value={bs.totalLiabilities} ccy={ccy} bold />
        {section('Equity', bs.equity)}
        <Row label="Current period earnings" value={bs.currentEarnings} ccy={ccy} indent />
        <Row label="Total equity" value={bs.totalEquity} ccy={ccy} bold />
        <div className="mt-3 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2">
          <span className="font-semibold text-ice">TOTAL LIABILITIES &amp; EQUITY</span>
          <span className="font-display text-lg font-bold text-accent">{money(bs.totalLiabilities + bs.totalEquity, ccy)}</span>
        </div>
        <div className={`mt-2 rounded-lg px-3 py-2 text-center text-xs ${bs.balanced ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
          {bs.balanced ? '✓ Assets = Liabilities + Equity' : `✗ Out of balance by ${money(bs.check, ccy)}`}
        </div>
      </div>
    </div>
  )
}

// ── Income statement ─────────────────────────────────────────────────────────
function IncomeView({ is, ccy, label }) {
  return (
    <div className="panel mx-auto max-w-2xl p-6">
      <div className="mb-1 eyebrow">Income Statement</div>
      <div className="mb-4 text-[11px] text-ice-faint">For the period {label}</div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ice-faint">Revenue</div>
      {is.income.map((a) => <Row key={a.account_id} label={`${a.code} · ${a.name}`} value={a.balance} ccy={ccy} indent />)}
      <Row label="Total revenue" value={is.revenue} ccy={ccy} bold />

      <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">Cost of sales</div>
      {is.cogs.length === 0 ? <p className="py-1 text-xs text-ice-faint/60">None</p> : is.cogs.map((a) => <Row key={a.account_id} label={`${a.code} · ${a.name}`} value={a.balance} ccy={ccy} indent />)}
      <Row label="Gross profit" value={is.grossProfit} ccy={ccy} bold tone={is.grossProfit >= 0 ? 'ok' : 'bad'} />

      <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">Operating expenses</div>
      {is.opex.map((a) => <Row key={a.account_id} label={`${a.code} · ${a.name}`} value={a.balance} ccy={ccy} indent />)}
      <Row label="Total operating expenses" value={is.operatingExpenses} ccy={ccy} bold />

      <div className="mt-4 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2.5">
        <span className="font-semibold text-ice">NET INCOME</span>
        <span className={`font-display text-xl font-bold ${is.netIncome >= 0 ? 'text-ok' : 'text-bad'}`}>{money(is.netIncome, ccy)}</span>
      </div>
      {is.revenue > 0 && (
        <div className="mt-2 flex justify-between text-[11px] text-ice-faint">
          <span>Gross margin {((is.grossProfit / is.revenue) * 100).toFixed(1)}%</span>
          <span>Net margin {((is.netIncome / is.revenue) * 100).toFixed(1)}%</span>
        </div>
      )}
    </div>
  )
}

// ── Cash flow (indirect) ─────────────────────────────────────────────────────
function CashFlowView({ cf, ccy, label }) {
  return (
    <div className="panel mx-auto max-w-2xl p-6">
      <div className="mb-1 eyebrow">Cash Flow Statement</div>
      <div className="mb-4 text-[11px] text-ice-faint">Indirect method · {label}</div>

      <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-ice-faint">Operating activities</div>
      <Row label="Net income" value={cf.netIncome} ccy={ccy} indent />
      <Row label="Add: depreciation" value={cf.depreciation} ccy={ccy} indent />
      <Row label="Change in receivables" value={cf.arChange} ccy={ccy} indent />
      <Row label="Change in inventory" value={cf.invChange} ccy={ccy} indent />
      <Row label="Change in prepaid expenses" value={cf.prepaidChange} ccy={ccy} indent />
      <Row label="Change in payables" value={cf.apChange} ccy={ccy} indent />
      <Row label="Change in accruals" value={cf.accruedChange} ccy={ccy} indent />
      <Row label="Change in payroll liabilities" value={cf.wagesChange} ccy={ccy} indent />
      <Row label="Net cash from operating" value={cf.operating} ccy={ccy} bold tone={cf.operating >= 0 ? 'ok' : 'bad'} />

      <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">Investing activities</div>
      <Row label="Purchase of fixed assets" value={cf.investing} ccy={ccy} indent />
      <Row label="Net cash from investing" value={cf.investing} ccy={ccy} bold />

      <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">Financing activities</div>
      <Row label="Loans and share capital" value={cf.financing} ccy={ccy} indent />
      <Row label="Net cash from financing" value={cf.financing} ccy={ccy} bold />

      <div className="mt-4 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2.5">
        <span className="font-semibold text-ice">NET CHANGE IN CASH</span>
        <span className={`font-display text-xl font-bold ${cf.netChange >= 0 ? 'text-ok' : 'text-bad'}`}>{money(cf.netChange, ccy)}</span>
      </div>
      <Row label="Opening cash" value={cf.openingCash} ccy={ccy} />
      <Row label="Closing cash" value={cf.closingCash} ccy={ccy} bold />
      <div className={`mt-2 rounded-lg px-3 py-2 text-center text-xs ${cf.reconciles ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn'}`}>
        {cf.reconciles ? '✓ Reconciles to the cash balance' : 'Does not reconcile — check for cash entries posted outside these categories'}
      </div>
    </div>
  )
}

// ── Trial balance ────────────────────────────────────────────────────────────
function TrialBalanceView({ accounts, totals, ccy }) {
  const active = accounts.filter((a) => a.total_debit || a.total_credit)
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
        <span className="eyebrow">Trial balance</span>
        {totals.balanced ? <Badge tone="ok">Debits = Credits</Badge> : <Badge tone="bad">Difference {money(totals.debit - totals.credit, ccy)}</Badge>}
      </div>
      {active.length === 0 ? <EmptyState title="No posted activity" hint="Use “Sync ledger” to post your invoices, bills, payroll, and issuances." />
      : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white/[0.02]"><tr>
              <th className="th">Code</th><th className="th">Account</th><th className="th">Type</th>
              <th className="th text-right">Debit</th><th className="th text-right">Credit</th><th className="th text-right">Balance</th>
            </tr></thead>
            <tbody>
              {active.map((a) => (
                <tr key={a.account_id} className="transition hover:bg-white/[0.025]">
                  <td className="td font-mono text-xs text-accent">{a.code}</td>
                  <td className="td">{a.name}</td>
                  <td className="td"><Badge tone="mute">{a.account_type}</Badge></td>
                  <td className="td text-right font-mono">{a.total_debit ? money(a.total_debit, ccy) : '—'}</td>
                  <td className="td text-right font-mono">{a.total_credit ? money(a.total_credit, ccy) : '—'}</td>
                  <td className="td text-right font-mono font-semibold">{money(a.balance, ccy)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-white/15 bg-white/[0.03]">
                <td className="td" colSpan={3}><b>Totals</b></td>
                <td className="td text-right font-mono font-bold">{money(totals.debit, ccy)}</td>
                <td className="td text-right font-mono font-bold">{money(totals.credit, ccy)}</td>
                <td className="td"></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Journal ──────────────────────────────────────────────────────────────────
function JournalView({ entries, accounts, ccy, canPost, onChange }) {
  const { activeOrgId } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), memo: '', lines: [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }] })

  const setLine = (i, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, [k]: v } : l) }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { account_id: '', debit: '', credit: '' }] }))
  const delLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))

  const dTot = form.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const cTot = form.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const balanced = Math.abs(dTot - cTot) < 0.01 && dTot > 0

  const save = async () => {
    if (!balanced) { toast.error('Entry must balance and have value'); return }
    try {
      const { data: ent, error } = await supabase.from('journal_entries').insert({
        org_id: activeOrgId, entry_date: form.entry_date, period: businessMonthKey(form.entry_date),
        memo: form.memo, source_type: 'manual', entry_no: `JV-${Date.now().toString().slice(-6)}`,
      }).select().single()
      if (error) throw error
      const lines = form.lines.filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)))
        .map((l) => ({ org_id: activeOrgId, entry_id: ent.id, account_id: l.account_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0) }))
      const { error: lErr } = await supabase.from('journal_lines').insert(lines)
      if (lErr) throw lErr
      const { error: pErr } = await supabase.rpc('post_journal_entry', { p_entry: ent.id })
      if (pErr) throw pErr
      toast.success('Journal posted'); setOpen(false)
      setForm({ entry_date: new Date().toISOString().slice(0, 10), memo: '', lines: [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }] })
      onChange()
    } catch (e) { toast.error(e.message) }
  }

  const opts = accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))

  return (
    <div>
      {canPost && <button onClick={() => setOpen(!open)} className="btn-primary mb-4"><Plus size={15} /> New journal entry</button>}

      {open && (
        <div className="panel mb-4 p-5">
          <div className="eyebrow mb-3">Manual journal entry</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date"><input className="input" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Memo"><input className="input" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="e.g. Monthly depreciation" /></Field></div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-[1fr_7rem_7rem_1.5rem] gap-2 font-mono text-[10px] uppercase text-ice-faint">
              <span>Account</span><span>Debit</span><span>Credit</span><span />
            </div>
            {form.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_7rem_1.5rem] items-center gap-2">
                <Select value={l.account_id} onChange={(e) => setLine(i, 'account_id', e.target.value)} options={[{ value: '', label: 'Select account…' }, ...opts]} />
                <input className="input" type="number" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} disabled={!!Number(l.credit)} />
                <input className="input" type="number" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} disabled={!!Number(l.debit)} />
                <button onClick={() => delLine(i)} className="text-ice-faint hover:text-bad"><X size={13} /></button>
              </div>
            ))}
            <button onClick={addLine} className="btn-ghost btn-sm"><Plus size={13} /> Line</button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-navy/50 px-3 py-2 text-sm">
            <span className="text-ice-dim">Debits {money(dTot, ccy)} · Credits {money(cTot, ccy)}</span>
            {balanced ? <Badge tone="ok">Balanced</Badge> : <Badge tone="bad">Difference {money(dTot - cTot, ccy)}</Badge>}
          </div>
          <button onClick={save} disabled={!balanced} className="btn-primary mt-3 w-full disabled:opacity-40">Post entry</button>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="border-b border-white/[0.06] px-5 py-3"><span className="eyebrow">Journal entries</span></div>
        {entries.length === 0 ? <EmptyState title="No entries" hint="Sync the ledger or post a manual journal." />
        : entries.map((e) => (
          <div key={e.id} className="flex items-center gap-3 border-b border-white/[0.04] px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent">{e.entry_no || e.id.slice(0, 8)}</span>
                <Badge tone="mute">{e.source_type}</Badge>
                {e.posted && <Badge tone="ok"><Lock size={9} className="mr-1 inline" />posted</Badge>}
              </div>
              <div className="truncate text-sm text-ice">{e.memo || '—'}</div>
            </div>
            <span className="font-mono text-[11px] text-ice-faint">{date(e.entry_date)}</span>
            <span className="font-mono text-[11px] text-ice-faint">{e.period}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Chart of accounts ────────────────────────────────────────────────────────
function ChartOfAccounts({ accounts, onChange }) {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const canWrite = ['owner', 'admin'].includes(role)
  const [form, setForm] = useState({ code: '', name: '', account_type: 'expense', subtype: 'operating_expense', normal_balance: 'debit', is_contra: false })

  const add = async () => {
    if (!form.code || !form.name) { toast.error('Code and name required'); return }
    try {
      const { error } = await supabase.from('gl_accounts').insert({ ...form, org_id: activeOrgId })
      if (error) throw error
      toast.success('Account added'); setForm({ code: '', name: '', account_type: 'expense', subtype: 'operating_expense', normal_balance: 'debit', is_contra: false }); onChange()
    } catch (e) { toast.error(e.message.includes('duplicate') ? 'That code already exists' : e.message) }
  }

  const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']
  const byType = TYPES.map((t) => [t, accounts.filter((a) => a.account_type === t)])

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {canWrite && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">Add account</div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="6000" /></Field>
              <Field label="Normal balance"><Select value={form.normal_balance} onChange={(e) => setForm({ ...form, normal_balance: e.target.value })} options={[{ value: 'debit', label: 'Debit' }, { value: 'credit', label: 'Credit' }]} /></Field>
            </div>
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value, normal_balance: ['asset', 'expense'].includes(e.target.value) ? 'debit' : 'credit' })} options={TYPES.map((t) => ({ value: t, label: t }))} /></Field>
            <Field label="Subtype"><input className="input" value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })} placeholder="current_asset" /></Field>
            <label className="flex items-center gap-2 text-xs text-ice"><input type="checkbox" checked={form.is_contra} onChange={(e) => setForm({ ...form, is_contra: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" /> Contra account</label>
            <button onClick={add} className="btn-primary w-full"><Plus size={14} /> Add account</button>
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">Subtypes drive statement grouping: <code>current_asset</code>, <code>fixed_asset</code>, <code>current_liability</code>, <code>long_term_liability</code>, <code>cost_of_sales</code>, <code>operating_expense</code>.</p>
        </div>
      )}

      <div className={`space-y-4 ${canWrite ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
        {byType.map(([t, list]) => (
          <div key={t} className="panel overflow-hidden">
            <div className="border-b border-white/[0.06] px-4 py-2.5"><span className="eyebrow">{t}s</span></div>
            {list.length === 0 ? <p className="p-4 text-xs text-ice-faint">None</p>
              : list.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2">
                  <span className="w-14 font-mono text-xs text-accent">{a.code}</span>
                  <span className="flex-1 text-sm text-ice">{a.name}</span>
                  {a.is_contra && <Badge tone="warn">contra</Badge>}
                  <Badge tone="mute">{a.normal_balance}</Badge>
                  <span className="font-mono text-[10px] text-ice-faint">{a.subtype}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
