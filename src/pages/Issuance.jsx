import { useMemo, useState } from 'react'
import ExportCsvButton from '../components/ExportCsvButton'
import { Plus, X, Search, Filter, Trash2, PackageMinus, Wallet, TrendingDown, Layers } from 'lucide-react'
import { useTable } from '../hooks/useTable'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, Field, Select, useToast, EmptyState } from '../components/ui'
import { money, num, date } from '../lib/format'
import { businessMonthKey, businessMonthKeyOffset } from '../lib/period'

const ISSUE_TO = ['work_order', 'department', 'asset', 'employee', 'other']

// Period helpers
const inPeriod = (d, period) => {
  if (!period || period === 'all') return true
  const dd = new Date(d), now = new Date()
  if (period === 'this_month') return businessMonthKey(d) === businessMonthKey(now)
  if (period === 'last_month') return businessMonthKey(d) === businessMonthKeyOffset(1)
  if (period === 'this_year') return dd.getFullYear() === now.getFullYear()
  if (period === 'last_30') return (now - dd) / 86400000 <= 30
  if (period === 'last_90') return (now - dd) / 86400000 <= 90
  return true
}

export default function Issuance() {
  const { role, activeOrg } = useAuth()
  const ccy = activeOrg?.currency || 'GHS'
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, remove } = useTable('issuances', { order: { column: 'issue_date', ascending: false } })
  const { rows: items } = useTable('inventory_items')
  const { rows: assets } = useTable('assets')
  const { rows: workOrders } = useTable('work_orders')
  const [drawer, setDrawer] = useState(false)
  const [saving, setSaving] = useState(false)
  const { can: _can_operations } = usePermissions()
  const canWrite = _can_operations('operations', 'edit')

  // Filters
  const [q, setQ] = useState('')
  const [fPeriod, setFPeriod] = useState('this_month')
  const [fType, setFType] = useState('')
  const [fDept, setFDept] = useState('')

  const filtered = useMemo(() => rows.filter((r) => {
    if (!inPeriod(r.issue_date, fPeriod)) return false
    if (fType && r.issued_to_type !== fType) return false
    if (fDept && r.department !== fDept) return false
    if (q.trim()) {
      const n = q.toLowerCase()
      if (!['issue_no','item_name','sku','issued_to','department'].some((k) => String(r[k] ?? '').toLowerCase().includes(n))) return false
    }
    return true
  }), [rows, q, fPeriod, fType, fDept])

  const totalSpend = filtered.reduce((s, r) => s + Number(r.total_cost || 0), 0)
  const totalQty = filtered.reduce((s, r) => s + Number(r.qty || 0), 0)

  // Spend grouped by item (top consumers)
  const byItem = useMemo(() => {
    const m = {}
    filtered.forEach((r) => { const k = r.item_name || r.sku || 'Unknown'; (m[k] ||= { qty: 0, cost: 0 }); m[k].qty += Number(r.qty || 0); m[k].cost += Number(r.total_cost || 0) })
    return Object.entries(m).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5)
  }, [filtered])

  // New issuance form
  const [form, setForm] = useState({ item_id: '', qty: '', issued_to_type: 'work_order', issued_to: '', department: '', issue_no: '', issue_date: new Date().toISOString().slice(0, 10), notes: '' })
  const selItem = items.find((i) => i.id === form.item_id)
  const lineCost = selItem ? Number(form.qty || 0) * Number(selItem.unit_cost || 0) : 0
  const overStock = selItem && Number(form.qty || 0) > Number(selItem.qty_on_hand || 0)

  const submit = async () => {
    if (!form.item_id || !form.qty) { toast.error('Pick an item and quantity'); return }
    if (overStock && !window.confirm('Quantity exceeds stock on hand. Issue anyway (stock will go negative)?')) return
    setSaving(true)
    try {
      await insert({
        item_id: form.item_id, item_name: selItem?.name, sku: selItem?.sku, uom: selItem?.uom,
        qty: Number(form.qty), unit_cost: Number(selItem?.unit_cost || 0), total_cost: lineCost,
        issued_to_type: form.issued_to_type, issued_to: form.issued_to, department: form.department,
        issue_no: form.issue_no || `ISS-${Date.now().toString().slice(-6)}`,
        issue_date: form.issue_date, notes: form.notes,
      })
      toast.success('Issued — inventory updated')
      setDrawer(false)
      setForm({ item_id: '', qty: '', issued_to_type: 'work_order', issued_to: '', department: '', issue_no: '', issue_date: new Date().toISOString().slice(0, 10), notes: '' })
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const del = async (row) => {
    if (!window.confirm(`Delete issuance ${row.issue_no}? Stock will be restored.`)) return
    try { await remove(row.id); toast.success('Reversed — stock restored') } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <PageHeader eyebrow="Supply Chain" title="Material Issuance" sub="Stock issued to people, work orders and departments.">
        {canWrite && <button className="btn-primary" onClick={() => setDrawer(true)}><Plus size={16} /> Issue item</button>}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Issuances" value={filtered.length} icon={PackageMinus} sub={fPeriod.replace('_', ' ')} />
        <StatCard label="Units issued" value={num(totalQty)} icon={Layers} />
        <StatCard label="Spend (period)" value={money(totalSpend, ccy)} tone="bad" icon={Wallet} />
        <StatCard label="Avg per issue" value={money(filtered.length ? totalSpend / filtered.length : 0, ccy)} icon={TrendingDown} />
      </div>

      {/* Filters */}
      <div className="toolbar mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="searchbox">
            <Search size={15} className="text-ice-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, SKU, issued to…"
              className="w-48 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
          </div>
          <Filter size={14} className="text-ice-faint" />
          <div className="w-40"><Select value={fPeriod} onChange={(e) => setFPeriod(e.target.value)}
            options={[{value:'all',label:'All time'},{value:'this_month',label:'This month'},{value:'last_month',label:'Last month'},{value:'last_30',label:'Last 30 days'},{value:'last_90',label:'Last 90 days'},{value:'this_year',label:'This year'}]} /></div>
          <div className="w-36"><Select value={fType} onChange={(e) => setFType(e.target.value)}
            options={[{value:'',label:'All targets'}, ...ISSUE_TO.map((s) => ({ value: s, label: s.replace('_', ' ') }))]} /></div>
          <div className="w-36"><Select value={fDept} onChange={(e) => setFDept(e.target.value)}
            options={[{value:'',label:'All depts'}, ...deptOptions]} /></div>
          <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} of {rows.length}</span>
          <ExportCsvButton name="issuances" rows={filtered} columns={[['issue_no', 'Issue no.'], ['issue_date', 'Date'], ['item_name', 'Item'], ['sku', 'SKU'], ['qty', 'Quantity'], ['uom', 'Unit'], ['unit_cost', 'Unit cost'], ['total_cost', 'Line cost'], ['issued_to_type', 'Issued to (type)'], ['issued_to', 'Issued to'], ['department', 'Department']]} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Table */}
        <div className="panel overflow-hidden lg:col-span-3">
          {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
          : filtered.length === 0 ? <EmptyState title="No issuances in this period" hint="Issue an item to deploy stock and track spend." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>
                  <th className="th">Ref</th><th className="th">Item</th><th className="th">Qty</th>
                  <th className="th">Cost</th><th className="th">Issued to</th><th className="th">Date</th>
                  {canWrite && <th className="th text-right">·</th>}
                </tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="td font-mono text-accent whitespace-nowrap">{r.issue_no}</td>
                      <td className="td">{r.item_name}<div className="font-mono text-[10px] text-ice-faint">{r.sku}</div></td>
                      <td className="td font-mono whitespace-nowrap">{num(r.qty)} {r.uom}</td>
                      <td className="td font-mono">{money(r.total_cost, ccy)}</td>
                      <td className="td"><Badge>{(r.issued_to_type || '').replace('_', ' ')}</Badge>{r.issued_to && <div className="mt-0.5 text-xs text-ice-faint">{r.issued_to}</div>}</td>
                      <td className="td whitespace-nowrap">{date(r.issue_date)}</td>
                      {canWrite && <td className="td text-right"><button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><Trash2 size={14} /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top consumers */}
        <div className="panel p-5 lg:col-span-2">
          <div className="eyebrow mb-4">Top consumers (by spend)</div>
          {byItem.length === 0 ? <div className="grid h-40 place-items-center text-sm text-ice-faint">No data</div>
          : <div className="space-y-3">
              {byItem.map(([name, v], i) => {
                const pct = totalSpend ? (v.cost / totalSpend) * 100 : 0
                return (
                  <div key={i}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="truncate text-ice/90">{name}</span>
                      <span className="font-mono text-ice-dim">{money(v.cost, ccy)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-ice-faint">{num(v.qty)} units · {pct.toFixed(0)}%</div>
                  </div>
                )
              })}
            </div>}
        </div>
      </div>

      {/* Issue drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">Issue Item</h2>
              <button onClick={() => setDrawer(false)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Item *"><Select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })}
                options={[{ value: '', label: 'Select item…' }, ...items.map((i) => ({ value: i.id, label: `${i.name} (${num(i.qty_on_hand)} ${i.uom} on hand)` }))]} /></Field>

              {selItem && (
                <div className="rounded-lg border border-white/10 bg-navy/50 px-3 py-2 text-sm">
                  <div className="flex justify-between"><span className="text-ice-faint">Unit cost</span><span className="font-mono text-ice">{money(selItem.unit_cost, ccy)}</span></div>
                  <div className="flex justify-between"><span className="text-ice-faint">On hand</span><span className={`font-mono ${overStock ? 'text-bad' : 'text-ice'}`}>{num(selItem.qty_on_hand)} {selItem.uom}</span></div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity *"><input className="input" type="number" min="0" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
                <Field label="Line cost"><input className="input font-mono" value={money(lineCost, ccy)} disabled /></Field>
              </div>
              {overStock && <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">Exceeds stock on hand — stock will go negative.</p>}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Issued to (type)"><Select value={form.issued_to_type} onChange={(e) => setForm({ ...form, issued_to_type: e.target.value })} options={ISSUE_TO.map((s) => ({ value: s, label: s.replace('_', ' ') }))} /></Field>
                <Field label="Reference / name"><input className="input" value={form.issued_to} onChange={(e) => setForm({ ...form, issued_to: e.target.value })} placeholder="WO-2601 / name" /></Field>
              </div>
              <Field label="Department"><Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issue no."><input className="input" value={form.issue_no} onChange={(e) => setForm({ ...form, issue_no: e.target.value })} placeholder="Auto if blank" /></Field>
                <Field label="Date"><input className="input" type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></Field>
              </div>
              <Field label="Notes"><textarea className="input min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(false)} className="btn-ghost">Cancel</button>
              <button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Issuing…' : 'Issue & deduct stock'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
