import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { StatCard, PageHeader, Badge } from '../components/ui'
import { daysUntil, date } from '../lib/format'
import { Wrench, ClipboardList, Boxes, ShieldAlert, AlertTriangle, ArrowUpRight } from 'lucide-react'

const ACCENT = 'rgb(var(--accent))'

export default function Dashboard() {
  const { activeOrgId, activeOrg } = useAuth()
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!activeOrgId) return
    let alive = true
    const f = (t, sel = '*') => supabase.from(t).select(sel).eq('org_id', activeOrgId)
    Promise.all([
      f('assets'), f('work_orders'), f('inventory_items'),
      f('hse_incidents'), supabase.from('documents_status').select('*').eq('org_id', activeOrgId),
    ]).then(([a, w, i, h, docs]) => {
      if (!alive) return
      setD({ assets: a.data || [], wos: w.data || [], inv: i.data || [], hse: h.data || [], docs: docs.data || [] })
    })
    return () => { alive = false }
  }, [activeOrgId])

  if (!d) return <div className="grid h-64 place-items-center text-ice-faint">Loading command deck…</div>

  const assetsDown = d.assets.filter((r) => r.status === 'down').length
  const woOpen = d.wos.filter((r) => ['open', 'in_progress', 'on_hold'].includes(r.status)).length
  const lowStock = d.inv.filter((r) => Number(r.qty_on_hand) <= Number(r.reorder_level)).length
  const hseOpen = d.hse.filter((r) => r.status !== 'closed').length

  const woByStatus = ['open', 'in_progress', 'on_hold', 'done', 'cancelled'].map((s) => ({
    name: s.replace('_', ' '), value: d.wos.filter((r) => r.status === s).length,
  })).filter((x) => x.value > 0)

  // Aggregated alerts across modules — the operational heartbeat
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
  d.hse.filter((h) => ['high', 'critical'].includes(h.severity) && h.status !== 'closed').forEach((h) =>
    alerts.push({ tone: 'bad', mod: 'HSE', to: '/hse', text: `${h.incident_no} ${h.severity} — ${h.incident_type.replace('_', ' ')}` }))
  d.docs.filter((x) => ['expired', 'critical', 'expiring'].includes(x.expiry_status)).forEach((x) =>
    alerts.push({ tone: x.expiry_status === 'expiring' ? 'warn' : 'bad', mod: 'Compliance', to: '/hse', text: `${x.name} ${x.expiry_status === 'expired' ? 'expired' : `expires ${date(x.expiry_date)}`}` }))

  return (
    <div>
      <PageHeader eyebrow={`${activeOrg?.org_name} · live`} title="Command Deck" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Assets down" value={assetsDown} tone={assetsDown ? 'bad' : 'ok'} icon={Wrench} sub={`${d.assets.length} registered`} />
        <StatCard label="Open work orders" value={woOpen} icon={ClipboardList} sub={`${d.wos.length} total`} />
        <StatCard label="Items to reorder" value={lowStock} tone={lowStock ? 'warn' : 'ok'} icon={Boxes} sub={`${d.inv.length} SKUs`} />
        <StatCard label="Open HSE cases" value={hseOpen} tone={hseOpen ? 'warn' : 'ok'} icon={ShieldAlert} sub={`${d.hse.length} logged`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="panel p-5 lg:col-span-3">
          <div className="eyebrow mb-4">Work orders by status</div>
          {woByStatus.length === 0 ? (
            <div className="grid h-56 place-items-center text-sm text-ice-faint">No work orders yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={woByStatus} margin={{ left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {woByStatus.map((_, i) => <Cell key={i} fill={ACCENT} fillOpacity={0.55 + (i / woByStatus.length) * 0.45} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel flex flex-col p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">Active alerts</span>
            <Badge tone={alerts.length ? 'bad' : 'ok'}>{alerts.length}</Badge>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto pr-1">
            {alerts.length === 0 ? (
              <div className="grid h-40 place-items-center text-sm text-ice-faint">All clear — no active alerts</div>
            ) : alerts.slice(0, 40).map((a, i) => (
              <Link key={i} to={a.to}
                className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:bg-white/[0.05]">
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
    </div>
  )
}
