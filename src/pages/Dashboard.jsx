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
  Wrench, ClipboardList, Boxes, ShieldAlert, AlertTriangle, ArrowUpRight,
  PackageMinus, Wallet, CalendarCheck, HardHat, TrendingUp, Users,
} from 'lucide-react'

const ACCENT = 'rgb(var(--accent))'
const PIE = ['#F59E0B', '#60A5FA', '#A78BFA', '#34D399', '#F87171', '#FBBF24']

export default function Dashboard() {
  const { activeOrgId, activeOrg } = useAuth()
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
      employees: has('workforce') ? f('employees') : null,
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

  if (!d) return <div className="grid h-64 place-items-center text-ice-faint">Loading command deck…</div>

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

  // Safety KPI this month (sum of completions by type)
  const safetyByType = ['ccv', 'pto', 'take5'].map((ft) => ({
    name: ft.toUpperCase(), value: d.safety.filter((k) => k.form_type === ft).reduce((s, k) => s + Number(k.done_this_month || 0), 0),
  })).filter((x) => x.value > 0)

  // ── Aggregated alerts ──
  const alerts = []
  d.assets.forEach((a) => {
    const dd = daysUntil(a.next_service_date)
    if (dd != null && dd <= 7) alerts.push({ tone: dd < 0 ? 'bad' : 'warn', mod: 'Assets', to: '/assets', text: `${a.name} service ${dd < 0 ? 'overdue' : `due in ${dd}d`}` })
    if (a.status === 'down') alerts.push({ tone: 'bad', mod: 'Assets', to: '/assets', text: `${a.name} is down` })
  })
  d.wos.forEach((w) => {
    const dd = daysUntil(w.due_date)
    if (dd != null && dd < 0 && !['done', 'cancelled'].includes(w.status)) alerts.push({ tone: 'bad', mod: 'Work Orders', to: '/work-orders', text: `${w.wo_number} overdue: ${w.title}` })
  })
  d.inv.filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level)).forEach((it) =>
    alerts.push({ tone: 'warn', mod: 'Inventory', to: '/inventory', text: `${it.name} below reorder (${it.qty_on_hand} ${it.uom})` }))
  d.invoices.filter((r) => r.status === 'overdue').forEach((r) =>
    alerts.push({ tone: 'bad', mod: 'Accounts', to: '/accounts', text: `Invoice ${r.invoice_no} overdue — ${money(r.total, ccy)}` }))
  d.leave.filter((r) => r.status === 'pending').forEach((r) =>
    alerts.push({ tone: 'warn', mod: 'Leave', to: '/hr', text: `Leave request pending: ${r.employee_name}` }))
  d.hse.filter((h) => ['high', 'critical'].includes(h.severity) && h.status !== 'closed').forEach((h) =>
    alerts.push({ tone: 'bad', mod: 'HSE', to: '/hse', text: `${h.incident_no} ${h.severity} — ${(h.incident_type || '').replace('_', ' ')}` }))
  d.docs.filter((x) => ['expired', 'critical', 'expiring'].includes(x.expiry_status)).forEach((x) =>
    alerts.push({ tone: x.expiry_status === 'expiring' ? 'warn' : 'bad', mod: 'Compliance', to: '/hse', text: `${x.name} ${x.expiry_status === 'expired' ? 'expired' : `expires ${date(x.expiry_date)}`}` }))

  return (
    <div>
      <PageHeader eyebrow={`${activeOrg?.org_name} · live`} title="Command Deck" />

      {/* News Flash slider */}
      <NewsFlash />

      {/* Module-aware KPI cards (first 4 shown prominently) */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.slice(0, 8)}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Work orders chart (if enabled) else fall back to safety */}
        {has('work_orders') && (
          <div className="panel p-5 lg:col-span-3">
            <div className="eyebrow mb-4">Work orders by status</div>
            {woByStatus.length === 0 ? <div className="grid h-56 place-items-center text-sm text-ice-faint">No work orders yet</div>
            : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={woByStatus} margin={{ left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={{ background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {woByStatus.map((_, i) => <Cell key={i} fill={ACCENT} fillOpacity={0.55 + (i / woByStatus.length) * 0.45} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Active alerts */}
        <div className={`panel flex flex-col p-5 ${has('work_orders') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">Active alerts</span>
            <Badge tone={alerts.length ? 'bad' : 'ok'}>{alerts.length}</Badge>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 320 }}>
            {alerts.length === 0 ? <div className="grid h-40 place-items-center text-sm text-ice-faint">All clear — no active alerts</div>
            : alerts.slice(0, 40).map((a, i) => (
              <Link key={i} to={a.to} className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:bg-white/[0.05]">
                <AlertTriangle size={15} className={`mt-0.5 ${a.tone === 'bad' ? 'text-bad' : 'text-warn'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ice/90">{a.text}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ice-faint">{a.mod}</div>
                </div>
                <ArrowUpRight size={14} className="mt-0.5 text-ice-faint" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary widget row — finance + safety, module-aware */}
      {(has('accounts') || has('hse')) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {has('accounts') && (
            <div className="panel p-5">
              <div className="eyebrow mb-4">Finance snapshot</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="text-xs text-ice-faint">Receivable (AR)</div>
                  <div className="mt-1 font-display text-xl font-bold text-warn">{money(outstandingAR, ccy)}</div>
                  <div className="mt-0.5 text-[11px] text-ice-faint">{d.invoices.filter((r) => r.status === 'overdue').length} overdue</div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="text-xs text-ice-faint">Payable (AP)</div>
                  <div className="mt-1 font-display text-xl font-bold text-ice">{money(payableAP, ccy)}</div>
                  <div className="mt-0.5 text-[11px] text-ice-faint">{d.bills.filter((r) => r.status !== 'paid').length} open bills</div>
                </div>
              </div>
            </div>
          )}
          {has('hse') && safetyByType.length > 0 && (
            <div className="panel p-5">
              <div className="eyebrow mb-4">Safety interactions this month</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={safetyByType} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3}>
                    {safetyByType.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
