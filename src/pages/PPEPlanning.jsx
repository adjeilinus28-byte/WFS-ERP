import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, Line, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, Select, useToast, EmptyState } from '../components/ui'
import { money, num } from '../lib/format'
import { businessMonthKey, businessMonthLabel, inCurrentBusinessMonth } from '../lib/period'
import { Shirt, Footprints, Ruler, Wallet, PackageMinus, AlertTriangle, TrendingUp, Users } from 'lucide-react'
import { at } from '../lib/tr'

const CARD = { background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }
const monthKey = (d) => (d ? businessMonthKey(d) : '')
const monthLabel = (k) => businessMonthLabel(k)

function Tabs({ tab, setTab }) {
  const items = [['sizes', at('Size Demand')], ['requirements', at('Dept Requirements')], ['consumption', at('Consumption Analysis')]]
  return (
    <div className="tabs mb-5">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`tab ${tab === k ? 'tab-on' : ''}`}>{l}</button>
      ))}
    </div>
  )
}

// Aggregate a size field across employees → [{ size, count }]
function tally(emps, field) {
  const m = {}
  emps.forEach((e) => { const v = (e[field] || '').toString().trim(); if (v) m[v] = (m[v] || 0) + 1 })
  return Object.entries(m).map(([size, count]) => ({ size, count })).sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }))
}

export default function PPEPlanning() {
  const { activeOrgId, activeOrg } = useAuth()
  const ccy = activeOrg?.currency || 'GHS'
  const { options: deptOptions } = useDepartments()
  const { rows: employees } = useTable('employees')
  const { rows: inventory } = useTable('inventory_items')
  const [tab, setTab] = useState('sizes')
  const [dept, setDept] = useState('')

  // ── Consumption data (issuances, PPE only) ──
  const [issuances, setIssuances] = useState([])
  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('issuances').select('*').eq('org_id', activeOrgId).then(({ data }) => setIssuances(data || []))
  }, [activeOrgId])

  // PPE inventory items (category ppe / uniform)
  const ppeItems = inventory.filter((i) => ['ppe', 'uniform', 'ppe/uniform'].includes((i.category || '').toLowerCase()))
  const ppeItemIds = new Set(ppeItems.map((i) => i.id))

  const emps = dept ? employees.filter((e) => e.department === dept) : employees

  const topSizes = useMemo(() => tally(emps, 'top_size'), [emps])
  const trouserSizes = useMemo(() => tally(emps, 'trouser_waist'), [emps])
  const shoeSizes = useMemo(() => tally(emps, 'shoe_size'), [emps])

  // Out-of-stock signal: PPE items below reorder
  const lowPpe = ppeItems.filter((i) => Number(i.qty_on_hand) <= Number(i.reorder_level))

  return (
    <div>
      <PageHeader eyebrow="Supply Chain" title="PPE & Uniform Planning" sub="PPE consumption and sizing needs across the workforce." />
      <Tabs tab={tab} setTab={setTab} />

      {/* Global dept filter */}
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">{at('Department:')}</span>
        <div className="w-52"><Select value={dept} onChange={(e) => setDept(e.target.value)} options={[{ value: '', label: at('All departments') }, ...deptOptions]} /></div>
        <span className="ml-auto font-mono text-[11px] text-ice-faint">{emps.length} employee(s)</span>
      </div>

      {tab === 'sizes' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
            <StatCard label="Workforce" value={emps.length} icon={Users} sub={dept || 'all depts'} />
            <StatCard label="Distinct top sizes" value={topSizes.length} icon={Shirt} />
            <StatCard label="Distinct waist sizes" value={trouserSizes.length} icon={Ruler} />
            <StatCard label="PPE items low" value={lowPpe.length} tone={lowPpe.length ? 'bad' : 'ok'} icon={AlertTriangle} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SizeChart title="Top / shirt sizes" data={topSizes} icon={Shirt} />
            <SizeChart title="Trouser waist sizes" data={trouserSizes} icon={Ruler} />
            <SizeChart title="Shoe sizes" data={shoeSizes} icon={Footprints} />
          </div>

          {/* PPE stock coverage */}
          <div className="panel mt-4 overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-3"><span className="eyebrow">{at('PPE / uniform stock coverage')}</span></div>
            {ppeItems.length === 0 ? <EmptyState title="No PPE items in inventory" hint="Tag inventory items with category 'ppe' or 'uniform' to track them here." />
            : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className="th">{at('Item')}</th><th className="th">{at('On hand')}</th><th className="th">{at('Reorder')}</th>
                    <th className="th">{at('Workforce need')}</th><th className="th">{at('Status')}</th>
                  </tr></thead>
                  <tbody>
                    {ppeItems.map((it) => {
                      const need = emps.length // one per employee, simple baseline
                      const short = Number(it.qty_on_hand) < need
                      const low = Number(it.qty_on_hand) <= Number(it.reorder_level)
                      return (
                        <tr key={it.id}>
                          <td className="td">{it.name}<div className="font-mono text-[10px] text-ice-faint">{it.sku}</div></td>
                          <td className="td font-mono">{num(it.qty_on_hand)} {it.uom}</td>
                          <td className="td font-mono">{num(it.reorder_level)}</td>
                          <td className="td font-mono">{need}</td>
                          <td className="td">{low ? <Badge tone="bad">{at('reorder')}</Badge> : short ? <Badge tone="warn">{at('short vs workforce')}</Badge> : <Badge tone="ok">ok</Badge>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'requirements' && <Requirements employees={employees} deptOptions={deptOptions} />}

      {tab === 'consumption' && <Consumption issuances={issuances.filter((r) => ppeItemIds.has(r.item_id))} ccy={ccy} deptOptions={deptOptions} />}
    </div>
  )
}

function SizeChart({ title, data, icon: Icon }) {
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center gap-2"><Icon size={15} className="text-accent" /><span className="eyebrow">{title}</span></div>
      {data.length === 0 ? <div className="grid h-48 place-items-center text-sm text-ice-faint">{at('No sizes recorded')}</div>
      : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="size" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={CARD} />
            <Bar dataKey="count" radius={[5, 5, 0, 0]} fill="rgb(var(--accent))" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// Per-department requirement matrix
function Requirements({ employees, deptOptions }) {
  const rows = useMemo(() => {
    const m = {}
    employees.forEach((e) => {
      const d = e.department || 'Unassigned'
      const r = (m[d] ||= { dept: d, headcount: 0, top: {}, trouser: {}, shoe: {} })
      r.headcount++
      if (e.top_size) r.top[e.top_size] = (r.top[e.top_size] || 0) + 1
      if (e.trouser_waist) r.trouser[e.trouser_waist] = (r.trouser[e.trouser_waist] || 0) + 1
      if (e.shoe_size) r.shoe[e.shoe_size] = (r.shoe[e.shoe_size] || 0) + 1
    })
    return Object.values(m).sort((a, b) => b.headcount - a.headcount)
  }, [employees])

  const fmt = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || '—'

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-white/[0.06] px-5 py-3"><span className="eyebrow">{at('Required PPE / uniforms per department')}</span></div>
      {rows.length === 0 ? <EmptyState title="No employees" hint="Add employees with sizing to see department requirements." />
      : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="th">{at('Department')}</th><th className="th">{at('Headcount')}</th>
              <th className="th">{at('Top sizes needed')}</th><th className="th">{at('Waist sizes needed')}</th><th className="th">{at('Shoe sizes needed')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="td font-semibold">{r.dept}</td>
                  <td className="td"><Badge tone="accent">{r.headcount}</Badge></td>
                  <td className="td text-sm">{fmt(r.top)}</td>
                  <td className="td text-sm">{fmt(r.trouser)}</td>
                  <td className="td text-sm">{fmt(r.shoe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// PPE consumption cost/quantity per department over a period
function Consumption({ issuances, ccy, deptOptions }) {
  const [period, setPeriod] = useState('this_year')
  const [dept, setDept] = useState('')

  const inPeriod = (d) => {
    if (!d) return false
    const dd = new Date(d), now = new Date()
    if (period === 'all') return true
    if (period === 'this_month') return inCurrentBusinessMonth(d)
    if (period === 'last_90') return (now - dd) / 86400000 <= 90
    if (period === 'this_year') return dd.getFullYear() === now.getFullYear()
    return true
  }

  const filtered = issuances.filter((r) => inPeriod(r.issue_date) && (!dept || r.department === dept))

  // By department
  const byDept = useMemo(() => {
    const m = {}
    filtered.forEach((r) => { const d = r.department || 'Unassigned'; const x = (m[d] ||= { dept: d, qty: 0, cost: 0 }); x.qty += Number(r.qty || 0); x.cost += Number(r.total_cost || 0) })
    return Object.values(m).sort((a, b) => b.cost - a.cost)
  }, [filtered])

  // Trend by month
  const trend = useMemo(() => {
    const m = {}
    filtered.forEach((r) => { const k = monthKey(r.issue_date); if (k) { const x = (m[k] ||= { qty: 0, cost: 0 }); x.qty += Number(r.qty || 0); x.cost += Number(r.total_cost || 0) } })
    return Object.keys(m).sort().slice(-12).map((k) => ({ name: monthLabel(k), cost: Math.round(m[k].cost), qty: m[k].qty }))
  }, [filtered])

  const totalCost = filtered.reduce((s, r) => s + Number(r.total_cost || 0), 0)
  const totalQty = filtered.reduce((s, r) => s + Number(r.qty || 0), 0)

  return (
    <div>
      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="w-40"><Select value={period} onChange={(e) => setPeriod(e.target.value)} options={[{ value: 'this_month', label: at('This month') }, { value: 'last_90', label: at('Last 90 days') }, { value: 'this_year', label: at('This year') }, { value: 'all', label: at('All time') }]} /></div>
        <div className="w-48"><Select value={dept} onChange={(e) => setDept(e.target.value)} options={[{ value: '', label: at('All departments') }, ...deptOptions]} /></div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="PPE issued (qty)" value={num(totalQty)} icon={PackageMinus} />
        <StatCard label="PPE spend" value={money(totalCost, ccy)} tone="bad" icon={Wallet} />
        <StatCard label="Departments" value={byDept.length} icon={Users} />
        <StatCard label="Avg / issue" value={money(filtered.length ? totalCost / filtered.length : 0, ccy)} icon={TrendingUp} />
      </div>

      {filtered.length === 0 ? <EmptyState title="No PPE consumption in this period" hint="Issue PPE items in the Issuance module to see cost analysis here." />
      : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-5">
            <div className="eyebrow mb-4">{at('Spend by department')}</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byDept} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="dept" width={90} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={CARD} formatter={(v, n) => n === 'cost' ? money(v, ccy) : v} />
                <Bar dataKey="cost" radius={[0, 5, 5, 0]} fill="rgb(var(--accent))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel p-5">
            <div className="eyebrow mb-4">{at('Consumption trend')}</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="r" orientation="right" allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CARD} formatter={(v, n) => n === 'cost' ? money(v, ccy) : v} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="cost" name="Cost" stroke="rgb(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="r" type="monotone" dataKey="qty" name="Qty" stroke="#60A5FA" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="panel overflow-hidden lg:col-span-2">
            <div className="border-b border-white/[0.06] px-5 py-3"><span className="eyebrow">{at('Department breakdown')}</span></div>
            <table className="w-full">
              <thead><tr><th className="th">{at('Department')}</th><th className="th">{at('Qty issued')}</th><th className="th">{at('Total cost')}</th><th className="th">{at('% of spend')}</th></tr></thead>
              <tbody>
                {byDept.map((r, i) => (
                  <tr key={i}>
                    <td className="td font-semibold">{r.dept}</td>
                    <td className="td font-mono">{num(r.qty)}</td>
                    <td className="td font-mono">{money(r.cost, ccy)}</td>
                    <td className="td font-mono">{totalCost ? ((r.cost / totalCost) * 100).toFixed(0) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
