import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid,
  PieChart, Pie, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { StatCard, PageHeader, Badge } from '../components/ui'
import { daysUntil, date, money } from '../lib/format'
import { inCurrentBusinessMonth, currentBusinessMonthLabel } from '../lib/period'
import NewsFlash from '../components/NewsFlash'
import {
  Wrench, ClipboardList, Boxes, ShieldAlert, AlertTriangle, ArrowUpRight, ArrowRight,
  PackageMinus, Wallet, CalendarCheck, TrendingUp, TrendingDown, Users, CheckCircle2,
  ShoppingCart, FileWarning,
} from 'lucide-react'
import { usePermissions } from '../hooks/usePermissions'
import { at } from '../lib/tr'

const ACCENT = 'rgb(var(--accent))'
const PIE = ['#F59E0B', '#60A5FA', '#A78BFA', '#34D399', '#F87171', '#FBBF24']
const TIP = { background: 'rgb(var(--navy-700))', border: '1px solid rgb(var(--line) / 0.1)', borderRadius: 10, color: 'rgb(var(--ice))', fontSize: 12 }
const TICK = { fill: 'rgb(var(--ice-faint))', fontSize: 11 }
const ALERT_ICON = { Assets: Wrench, 'Work Orders': ClipboardList, Inventory: Boxes, Accounts: Wallet, Leave: CalendarCheck, HSE: ShieldAlert, Compliance: FileWarning, Procurement: ShoppingCart }

// Panel heading: title + small subtitle, optional link on the right.
function PanelHead({ title, sub, to, link, right }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-[17px] font-bold leading-tight text-ice">{at(title)}</h2>
        {sub && <p className="mt-0.5 text-xs text-ice-faint">{sub}</p>}
      </div>
      {right}
      {to && <Link to={to} className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">{at(link)} <ArrowRight size={12} /></Link>}
    </div>
  )
}

// Labelled progress bar (value out of total).
function Meter({ label, value, total, tone }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  const bar = { ok: 'bg-ok', info: 'bg-info', bad: 'bg-bad', warn: 'bg-warn' }[tone] || 'bg-accent'
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ice-dim">{at(label)}</span>
        <span className="font-mono text-sm font-medium text-ice">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${value > 0 ? Math.max(pct, 3) : 0}%` }} />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { activeOrgId, activeOrg } = useAuth()
  const { pageVisible } = usePermissions()
  const [d, setD] = useState(null)
  const mods = activeOrg?.enabled_modules || []
  const has = (m) => mods.includes(m)
  const ccy = activeOrg?.currency || 'GHS'

  useEffect(() => {
    if (!activeOrgId) return
    let alive = true
    const f = (t, sel = '*') => supabase.from(t).select(sel).eq('org_id', activeOrgId)
    // Fetch only what the enabled modules need
    const jobs = {
      assets: has('assets') ? f('assets') : null,
      wos: has('work_orders') ? f('work_orders') : null,
      inv: has('inventory') ? f('inventory_items') : null,
      hse: has('hse') ? f('hse_incidents') : null,
      docs: has('hse') ? supabase.from('documents_status').select('*').eq('org_id', activeOrgId) : null,
      issuance: has('issuance') ? f('issuances') : null,
      invoices: has('accounts') ? f('invoices') : null,
      bills: has('accounts') ? f('bills') : null,
      leave: has('hr') ? f('leave_requests') : null,
      safety: has('hse') ? supabase.from('safety_kpi').select('*').eq('org_id', activeOrgId) : null,
      employees: has('workforce') ? f('employees', 'id,status') : null,
    }
    const keys = Object.keys(jobs)
    Promise.all(keys.map((k) => jobs[k] || Promise.resolve({ data: [] }))).then((res) => {
      if (!alive) return
      const out = {}
      keys.forEach((k, i) => { out[k] = res[i]?.data || [] })
      setD(out)
    })
    return () => { alive = false }
  }, [activeOrgId, mods.join(',')])

  if (!d) return <div className="grid h-64 place-items-center text-ice-faint">{at('Loading command deck…')}</div>

  // ── Metrics (guarded by module) ──
  const assetsDown = d.assets.filter((r) => r.status === 'down').length
  const woOpen = d.wos.filter((r) => ['open', 'in_progress', 'on_hold'].includes(r.status)).length
  const lowStock = d.inv.filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level)).length
  const hseOpen = d.hse.filter((r) => r.status !== 'closed').length
  const issueSpend = d.issuance.filter((r) => r.issue_date && inCurrentBusinessMonth(r.issue_date)).reduce((s, r) => s + Number(r.total_cost || 0), 0)
  const outstandingAR = d.invoices.filter((r) => ['sent', 'approved', 'partial', 'overdue'].includes(r.status)).reduce((s, r) => s + Number(r.total || 0), 0)
  const payableAP = d.bills.filter((r) => r.status !== 'paid').reduce((s, r) => s + Number(r.total || r.amount || 0), 0)
  const onLeave = d.leave.filter((r) => { const now = new Date(); return r.status === 'approved' && new Date(r.start_date) <= now && new Date(r.end_date) >= now }).length
  const pendingLeave = d.leave.filter((r) => r.status === 'pending').length

  // ── Dynamic KPI cards based on enabled modules ──
  const cards = []
  if (has('assets')) cards.push(<StatCard key="a" label="Assets down" value={assetsDown} tone={assetsDown ? 'bad' : 'ok'} icon={Wrench} sub={`${d.assets.length} registered`} />)
  if (has('work_orders')) cards.push(<StatCard key="w" label="Open work orders" value={woOpen} icon={ClipboardList} sub={`${d.wos.length} total`} />)
  if (has('inventory')) cards.push(<StatCard key="i" label="Items to reorder" value={lowStock} tone={lowStock ? 'warn' : 'ok'} icon={Boxes} sub={`${d.inv.length} SKUs`} />)
  if (has('issuance')) cards.push(<StatCard key="is" label="Issuance spend (mo)" value={money(issueSpend, ccy)} icon={PackageMinus} sub={currentBusinessMonthLabel()} />)
  if (has('accounts')) cards.push(<StatCard key="ar" label="Outstanding AR" value={money(outstandingAR, ccy)} tone={outstandingAR ? 'warn' : 'ok'} icon={TrendingUp} />)
  if (has('accounts')) cards.push(<StatCard key="ap" label="Payables (AP)" value={money(payableAP, ccy)} icon={Wallet} />)
  if (has('hr')) cards.push(<StatCard key="lv" label="On leave now" value={onLeave} icon={CalendarCheck} sub={`${pendingLeave} pending`} />)
  if (has('hse')) cards.push(<StatCard key="h" label="Open HSE cases" value={hseOpen} tone={hseOpen ? 'warn' : 'ok'} icon={ShieldAlert} sub={`${d.hse.length} logged`} />)
  if (has('workforce') && cards.length < 4) cards.push(<StatCard key="emp" label="Employees" value={d.employees.length} icon={Users} />)

  // ── Charts ──
  const woByStatus = ['open', 'in_progress', 'on_hold', 'done', 'cancelled'].map((s) => ({
    name: s.replace('_', ' '), value: d.wos.filter((r) => r.status === s).length,
  })).filter((x) => x.value > 0)

  // Material issuance spend for the last 6 calendar months (real data).
  const now = new Date()
  const spendMonths = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
    return { key, name: m.toLocaleString(undefined, { month: 'short' }), value: 0 }
  })
  d.issuance.forEach((r) => {
    const slot = r.issue_date && spendMonths.find((m) => m.key === String(r.issue_date).slice(0, 7))
    if (slot) slot.value += Number(r.total_cost || 0)
  })
  const spendTotal = spendMonths.reduce((t, m) => t + m.value, 0)
  const spendLast = spendMonths[5].value, spendPrev = spendMonths[4].value
  const spendDelta = spendPrev > 0 ? ((spendLast - spendPrev) / spendPrev) * 100 : null

  // Safety KPI this month (sum of completions by type)
  const safetyByType = ['ccv', 'pto', 'take5'].map((ft) => ({
    name: ft.toUpperCase(), value: d.safety.filter((k) => k.form_type === ft).reduce((s, k) => s + Number(k.done_this_month || 0), 0),
  })).filter((x) => x.value > 0)

  // People snapshot
  const headcount = d.employees.length
  const activeStaff = d.employees.filter((r) => r.status === 'active').length

  // ── Aggregated alerts ──
  const alerts = []
  d.assets.forEach((a) => {
    const dd = daysUntil(a.next_service_date)
    if (dd != null && dd <= 7) alerts.push({ tone: dd < 0 ? 'bad' : 'warn', mod: 'Assets', to: '/assets', text: `${a.name} service ${dd < 0 ? 'overdue' : `due in ${dd}d`}` })
    if (a.status === 'down') alerts.push({ tone: 'bad', mod: 'Assets', to: '/assets', text: `${a.name} is down` })
  })
  d.wos.forEach((w) => {
    const dd = daysUntil(w.due_date)
    if (dd != null && dd < 0 && !['done', at('cancelled')].includes(w.status)) alerts.push({ tone: 'bad', mod: 'Work Orders', to: '/work-orders', text: `${w.wo_number} overdue: ${w.title}` })
  })
  d.inv.filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level)).forEach((it) =>
    alerts.push({ tone: 'warn', mod: 'Inventory', to: '/inventory', text: `${it.name} below reorder (${it.qty_on_hand} ${it.uom})` }))
  d.invoices.filter((r) => r.status === 'overdue').forEach((r) =>
    alerts.push({ tone: 'bad', mod: 'Accounts', to: '/accounts', text: `Invoice ${r.invoice_no} overdue — ${money(r.total, ccy)}` }))
  d.leave.filter((r) => r.status === 'pending').forEach((r) =>
    alerts.push({ tone: 'warn', mod: 'Leave', to: '/hr', text: `Leave request pending: ${r.employee_name}` }))
  d.hse.filter((h) => ['high', at('critical')].includes(h.severity) && h.status !== 'closed').forEach((h) =>
    alerts.push({ tone: 'bad', mod: 'HSE', to: '/hse', text: `${h.incident_no} ${h.severity} — ${(h.incident_type || '').replace('_', ' ')}` }))
  d.docs.filter((x) => ['expired', 'critical', 'expiring'].includes(x.expiry_status)).forEach((x) =>
    alerts.push({ tone: x.expiry_status === 'expiring' ? 'warn' : 'bad', mod: 'Compliance', to: '/hse', text: `${x.name} ${x.expiry_status === 'expired' ? 'expired' : `expires ${date(x.expiry_date)}`}` }))

  const bad = alerts.filter((a) => a.tone === 'bad').length
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
  const showSpend = has('issuance')
  const showPeople = has('workforce') || has('hr') || has('hse')

  const woChart = (
    woByStatus.length === 0 ? <div className="grid h-56 place-items-center text-sm text-ice-faint">{at('No work orders yet')}</div>
    : (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={woByStatus} margin={{ left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line) / 0.06)" vertical={false} />
          <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: 'rgb(var(--wash) / 0.04)' }} contentStyle={TIP} />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={72}>
            {woByStatus.map((_, i) => <Cell key={i} fill={ACCENT} fillOpacity={0.55 + (i / woByStatus.length) * 0.45} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  )

  return (
    <div>
      <PageHeader eyebrow={`${activeOrg?.org_name || ''} · ${today}`} title="Command Deck"
        sub={alerts.length
          ? `${at('Live picture of your operation.')} ${alerts.length} ${at(alerts.length === 1 ? 'item needs your attention.' : 'items need your attention.')}`
          : `${at('Live picture of your operation.')} ${at('All clear right now.')}`} />

      {/* News Flash slider */}
      <NewsFlash />

      {/* Module-aware KPI cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {cards.slice(0, 8)}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Main chart: issuance spend trend, or work orders when issuance is off */}
        {(showSpend || has('work_orders')) && (
          <div className="panel flex flex-col p-5 lg:col-span-3 lg:p-6">
            {showSpend ? (
              <>
                <PanelHead title="Material issuance spend" sub={`${at('Last 6 months')} · ${ccy}`}
                  to={pageVisible('reports') && has('reports') ? '/reports' : null} link="View report" />
                <div className="mb-4 flex flex-wrap items-end gap-2.5">
                  <span className="font-display text-[28px] font-bold leading-none tracking-tight text-ice">{money(spendTotal, ccy)}</span>
                  {spendDelta != null && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${spendDelta > 0 ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'}`}
                      title={at('This month vs last month')}>
                      {spendDelta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {Math.abs(spendDelta).toFixed(1)}%
                    </span>
                  )}
                </div>
                {spendTotal === 0 ? <div className="grid h-56 flex-1 place-items-center text-sm text-ice-faint">{at('No issuances in the last 6 months')}</div>
                : (
                  <div className="min-h-[240px] flex-1">
                    <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                      <BarChart data={spendMonths} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} barCategoryGap="18%">
                        <defs>
                          <linearGradient id="barNow" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="rgb(var(--accent))" stopOpacity="1" />
                            <stop offset="1" stopColor="rgb(var(--accent))" stopOpacity="0.65" />
                          </linearGradient>
                          <linearGradient id="barPast" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="rgb(var(--navy-500))" stopOpacity="1" />
                            <stop offset="1" stopColor="rgb(var(--navy-600))" stopOpacity="0.7" />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: 'rgb(var(--wash) / 0.04)' }} contentStyle={TIP} formatter={(v) => [money(v, ccy), at('Spend')]} />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={96}>
                          {spendMonths.map((_, i) => <Cell key={i} fill={i === 5 ? 'url(#barNow)' : 'url(#barPast)'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <>
                <PanelHead title="Work orders by status" sub={`${d.wos.length} ${at('total')}`} to="/work-orders" link="Open work orders" />
                {woChart}
              </>
            )}
          </div>
        )}

        {/* Right column: attention list + people & safety */}
        <div className={`flex flex-col gap-4 ${(showSpend || has('work_orders')) ? 'lg:col-span-2' : 'lg:col-span-5'}`}>
          <div className="panel flex flex-col p-5 lg:p-6">
            <PanelHead title="Needs your attention"
              sub={alerts.length ? `${bad} ${at('critical')} · ${alerts.length - bad} ${at('warnings')}` : at('Approvals and alerts')}
              to={pageVisible('approvals') && has('approvals') ? '/approvals' : null} link="Open inbox"
              right={!(pageVisible('approvals') && has('approvals')) ? <Badge tone={alerts.length ? 'bad' : 'ok'}>{alerts.length}</Badge> : null} />
            <div className="-mr-1 flex-1 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 300 }}>
              {alerts.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-ice-faint">
                  <span className="chip bg-ok/10 text-ok"><CheckCircle2 size={16} /></span>
                  {at('All clear — no active alerts')}
                </div>
              ) : alerts.slice(0, 40).map((a, i) => {
                const Icon = ALERT_ICON[a.mod] || AlertTriangle
                return (
                  <Link key={i} to={a.to} className="group flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 transition hover:bg-white/[0.06]">
                    <span className={`chip ${a.tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn'}`}><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ice">{a.text}</div>
                      <div className="text-xs text-ice-faint">{at(a.mod)}</div>
                    </div>
                    <span className="hidden shrink-0 items-center gap-1 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-ice-dim transition group-hover:bg-accent-soft group-hover:text-accent sm:flex">
                      {at('Review')} <ArrowUpRight size={12} />
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>

          {showPeople && (
            <div className="panel p-5 lg:p-6">
              <PanelHead title="People & safety" sub={at('Right now')} />
              <div className="space-y-4">
                {has('workforce') && <Meter label="Active employees" value={activeStaff} total={headcount} tone="ok" />}
                {has('hr') && <Meter label="On leave now" value={onLeave} total={headcount || onLeave} tone="info" />}
                {has('hse') && <Meter label="Open HSE cases" value={hseOpen} total={d.hse.length} tone={hseOpen ? 'bad' : 'ok'} />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Secondary row — work orders (when the main slot shows spend), finance, safety */}
      {((showSpend && has('work_orders')) || has('accounts') || (has('hse') && safetyByType.length > 0)) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {showSpend && has('work_orders') && (
            <div className="panel p-5 lg:p-6">
              <PanelHead title="Work orders by status" sub={`${d.wos.length} ${at('total')}`} to="/work-orders" link="Open work orders" />
              {woChart}
            </div>
          )}
          {has('accounts') && (
            <div className="panel p-5 lg:p-6">
              <PanelHead title="Finance snapshot" sub={at('Receivables and payables')} to="/accounts" link="Open accounts" />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[0.03] p-4">
                  <div className="text-xs text-ice-faint">{at('Receivable (AR)')}</div>
                  <div className="mt-1 truncate font-display text-xl font-bold text-warn">{money(outstandingAR, ccy)}</div>
                  <div className="mt-0.5 text-[11px] text-ice-faint">{d.invoices.filter((r) => r.status === 'overdue').length} {at('overdue')}</div>
                </div>
                <div className="rounded-xl bg-white/[0.03] p-4">
                  <div className="text-xs text-ice-faint">{at('Payable (AP)')}</div>
                  <div className="mt-1 truncate font-display text-xl font-bold text-ice">{money(payableAP, ccy)}</div>
                  <div className="mt-0.5 text-[11px] text-ice-faint">{d.bills.filter((r) => r.status !== 'paid').length} {at('open bills')}</div>
                </div>
              </div>
            </div>
          )}
          {has('hse') && safetyByType.length > 0 && (
            <div className="panel p-5 lg:p-6">
              <PanelHead title="Safety interactions this month" />
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={safetyByType} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3}>
                    {safetyByType.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip contentStyle={TIP} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
