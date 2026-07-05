import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, useToast } from '../components/ui'
import { money } from '../lib/format'
import { Sparkles, Printer, FileBarChart, Download, Wrench, ShieldAlert, Wallet, PackageMinus } from 'lucide-react'

const PALETTE = ['rgb(var(--accent))', '#38BDF8', '#34D399', '#F472B6', '#A78BFA', '#FBBF24']
const CARD = { background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }
const monthKey = (d) => (d ? String(d).slice(0, 7) : '')
const monthLabel = (k) => { const [y, m] = k.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' }) }

export default function Reports() {
  const { activeOrgId, activeOrg } = useAuth()
  const toast = useToast()
  const mods = activeOrg?.enabled_modules || []
  const has = (m) => mods.includes(m)
  const ccy = activeOrg?.currency || 'GHS'
  const [snap, setSnap] = useState(null)
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeOrgId) return
    const f = (t, sel = '*') => supabase.from(t).select(sel).eq('org_id', activeOrgId)
    const jobs = {
      assets: has('assets') ? f('assets') : null,
      wos: has('work_orders') ? f('work_orders') : null,
      inv: has('inventory') ? f('inventory_items') : null,
      hse: has('hse') ? f('hse_incidents') : null,
      issuance: has('issuance') ? f('issuances') : null,
      invoices: has('accounts') ? f('invoices') : null,
      bills: has('accounts') ? f('bills') : null,
      leave: has('hr') ? f('leave_requests') : null,
      safety: has('hse') ? supabase.from('safety_kpi').select('*').eq('org_id', activeOrgId) : null,
    }
    const keys = Object.keys(jobs)
    Promise.all(keys.map((k) => jobs[k] || Promise.resolve({ data: [] }))).then((res) => {
      const out = {}; keys.forEach((k, i) => { out[k] = res[i]?.data || [] }); setSnap(out)
    })
  }, [activeOrgId, mods.join(',')])

  const generate = async () => {
    setBusy(true); setReport('')
    try {
      const res = await fetch('/.netlify/functions/generate-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: activeOrgId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setReport(data.report || '')
    } catch (e) { toast.error(e.message + ' — deploy the Netlify functions and set ANTHROPIC_API_KEY first.') } finally { setBusy(false) }
  }

  const exportCsv = () => {
    if (!snap) return
    const rows = [['Metric', 'Value']]
    if (has('assets')) rows.push(['Registered assets', snap.assets.length], ['Assets down', snap.assets.filter((r) => r.status === 'down').length])
    if (has('work_orders')) rows.push(['Work orders', snap.wos.length], ['Open work orders', snap.wos.filter((r) => ['open', 'in_progress', 'on_hold'].includes(r.status)).length])
    if (has('inventory')) rows.push(['Stock value', invValue], ['SKUs', snap.inv.length])
    if (has('accounts')) rows.push(['Outstanding AR', outstandingAR], ['Payable AP', payableAP])
    if (has('hse')) rows.push(['HSE cases', snap.hse.length])
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `wfs-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  const invValue = useMemo(() => (snap?.inv || []).reduce((s, r) => s + Number(r.qty_on_hand || 0) * Number(r.unit_cost || 0), 0), [snap])
  const outstandingAR = useMemo(() => (snap?.invoices || []).filter((r) => ['sent', 'approved', 'partial', 'overdue'].includes(r.status)).reduce((s, r) => s + Number(r.total || 0), 0), [snap])
  const payableAP = useMemo(() => (snap?.bills || []).filter((r) => r.status !== 'paid').reduce((s, r) => s + Number(r.total || r.amount || 0), 0), [snap])

  if (!snap) return <div className="grid h-64 place-items-center text-ice-faint">Loading…</div>

  // ── Chart datasets ──
  const woPie = ['open', 'in_progress', 'on_hold', 'done', 'cancelled'].map((s) => ({ name: s.replace('_', ' '), value: snap.wos.filter((r) => r.status === s).length })).filter((x) => x.value)
  const hsePie = ['near_miss', 'injury', 'spill', 'equipment', 'environmental'].map((s) => ({ name: s.replace('_', ' '), value: snap.hse.filter((r) => r.incident_type === s).length })).filter((x) => x.value)

  // Issuance spend by month (last 6)
  const issuanceTrend = (() => {
    const m = {}
    snap.issuance.forEach((r) => { const k = monthKey(r.issue_date); if (k) m[k] = (m[k] || 0) + Number(r.total_cost || 0) })
    return Object.keys(m).sort().slice(-6).map((k) => ({ name: monthLabel(k), spend: Math.round(m[k]) }))
  })()

  // Invoices AR by status
  const arByStatus = ['draft', 'sent', 'approved', 'partial', 'paid', 'overdue'].map((s) => ({ name: s, value: snap.invoices.filter((r) => r.status === s).reduce((a, r) => a + Number(r.total || 0), 0) })).filter((x) => x.value)

  // Leave by type
  const leavePie = (() => {
    const m = {}
    snap.leave.filter((r) => r.status === 'approved').forEach((r) => { m[r.leave_type] = (m[r.leave_type] || 0) + Number(r.working_days || r.days || 0) })
    return Object.entries(m).map(([name, value]) => ({ name, value }))
  })()

  // Safety KPI by type
  const safetyBar = ['ccv', 'pto', 'take5'].map((ft) => ({ name: ft.toUpperCase(), value: snap.safety.filter((k) => k.form_type === ft).reduce((s, k) => s + Number(k.done_this_month || 0), 0) })).filter((x) => x.value)

  // ── Module-aware KPI cards ──
  const cards = []
  if (has('assets')) cards.push(<StatCard key="a" label="Registered assets" value={snap.assets.length} icon={Wrench} />)
  if (has('work_orders')) cards.push(<StatCard key="w" label="Work orders" value={snap.wos.length} icon={FileBarChart} />)
  if (has('inventory')) cards.push(<StatCard key="i" label="Stock value" value={money(invValue, ccy)} icon={PackageMinus} />)
  if (has('accounts')) cards.push(<StatCard key="ar" label="Outstanding AR" value={money(outstandingAR, ccy)} icon={Wallet} />)
  if (has('hse')) cards.push(<StatCard key="h" label="HSE cases" value={snap.hse.length} icon={ShieldAlert} />)

  const Panel = ({ title, children }) => (
    <div className="panel p-5"><div className="eyebrow mb-4">{title}</div>{children}</div>
  )
  const donut = (data) => (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={CARD} /><Legend wrapperStyle={{ fontSize: 12, color: '#CBD5E1' }} />
      </PieChart>
    </ResponsiveContainer>
  )

  return (
    <div>
      <PageHeader eyebrow="Insight" title="Reports">
        <button className="btn-ghost" onClick={exportCsv}><Download size={15} /> Export CSV</button>
        <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print</button>
        <button className="btn-primary" onClick={generate} disabled={busy}><Sparkles size={15} /> {busy ? 'Generating…' : 'Generate AI report'}</button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.slice(0, 8)}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        {has('work_orders') && <Panel title="Work order distribution">{woPie.length ? donut(woPie) : <div className="grid h-56 place-items-center text-sm text-ice-faint">No data</div>}</Panel>}
        {has('hse') && <Panel title="HSE incidents by type">{hsePie.length ? donut(hsePie) : <div className="grid h-56 place-items-center text-sm text-ice-faint">No incidents — good news</div>}</Panel>}

        {has('issuance') && issuanceTrend.length > 0 && (
          <Panel title="Material issuance spend (6 mo)">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={issuanceTrend} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CARD} formatter={(v) => money(v, ccy)} />
                <Line type="monotone" dataKey="spend" stroke="rgb(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {has('accounts') && arByStatus.length > 0 && (
          <Panel title="Accounts receivable by status">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={arByStatus} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CARD} formatter={(v) => money(v, ccy)} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>{arByStatus.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {has('hr') && leavePie.length > 0 && <Panel title="Approved leave by type (days)">{donut(leavePie)}</Panel>}
        {has('hse') && safetyBar.length > 0 && (
          <Panel title="Safety interactions this month">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={safetyBar} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CARD} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>{safetyBar.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}
      </div>

      {report && (
        <div className="panel mt-4 p-6 animate-rise">
          <div className="eyebrow mb-3">AI operations summary</div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-ice/90">{report}</div>
        </div>
      )}
    </div>
  )
}
