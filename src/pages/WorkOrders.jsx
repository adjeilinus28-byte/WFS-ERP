import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Search, Filter, X } from 'lucide-react'
import { useTable } from '../hooks/useTable'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, statusTone, useToast, Select, EmptyState } from '../components/ui'
import Drawer from '../components/Drawer'
import { date, daysUntil } from '../lib/format'
import { ClipboardList, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { at } from '../lib/tr'

const TYPE     = ['preventive', 'corrective', 'inspection']
const PRIORITY = ['low', 'medium', 'high', 'urgent']
const STATUS   = ['open', 'in_progress', 'on_hold', 'done', 'cancelled']

// ── Inline progress bar with quick-set buttons ──────────────────────────────
function ProgressCell({ value, onCommit, disabled }) {
  // Local drag state so the table doesn't re-query on every step; persist on release.
  const [drag, setDrag] = useState(null)
  const v = drag != null ? drag : Number(value || 0)
  const tone = v >= 100 ? 'bg-ok' : v >= 50 ? 'bg-accent' : v > 0 ? 'bg-warn' : 'bg-white/20'
  const commit = () => { if (drag != null && drag !== Number(value || 0)) onCommit(drag); setDrag(null) }
  return (
    <div className="flex items-center gap-2 min-w-[150px]">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`absolute inset-y-0 left-0 rounded-full ${drag == null ? 'transition-all' : ''} ${tone}`} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs text-ice-dim">{v}%</span>
      {!disabled && (
        <input type="range" min="0" max="100" step="5" value={v}
          onChange={(e) => setDrag(Number(e.target.value))}
          onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit}
          className="h-1 w-16 cursor-pointer accent-[rgb(var(--accent))]" title="Drag to update progress" />
      )}
    </div>
  )
}

const empty = { wo_number: '', title: '', wo_type: 'corrective', priority: 'medium', status: 'open', assigned_to: '', department: '', due_date: '', progress: 0, description: '' }

export default function WorkOrders() {
  const { role } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove, refresh } = useTable('work_orders')
  const [drawer, setDrawer] = useState({ open: false, row: null })
  const [saving, setSaving] = useState(false)
  const canWrite = role && role !== 'viewer'

  // ── Filters ──
  const [q, setQ] = useState('')
  const [fDept, setFDept] = useState('')
  const [fPriority, setFPriority] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fView, setFView] = useState('')   // all | uncompleted | overdue | due_soon | unassigned

  // Local mirror so progress writes don't trigger a full-table refetch (which caused the glitch)
  const [localRows, setLocalRows] = useState(null)
  const effectiveRows = localRows || rows
  // Keep the mirror in sync when the underlying data reloads (create/edit/delete)
  useEffect(() => { setLocalRows(null) }, [rows])

  const filtered = useMemo(() => {
    const today = new Date()
    return effectiveRows.filter((r) => {
      if (q.trim()) {
        const n = q.toLowerCase()
        const hit = ['wo_number','title','assigned_to','department'].some((k) => String(r[k] ?? '').toLowerCase().includes(n))
        if (!hit) return false
      }
      if (fDept && r.department !== fDept) return false
      if (fPriority && r.priority !== fPriority) return false
      if (fStatus && r.status !== fStatus) return false
      const d = daysUntil(r.due_date)
      if (fView === 'uncompleted' && ['done', at('cancelled')].includes(r.status)) return false
      if (fView === 'overdue' && !(d != null && d < 0 && !['done', at('cancelled')].includes(r.status))) return false
      if (fView === 'due_soon' && !(d != null && d >= 0 && d <= 3 && !['done', at('cancelled')].includes(r.status))) return false
      if (fView === 'unassigned' && r.assigned_to) return false
      return true
    })
  }, [effectiveRows, q, fDept, fPriority, fStatus, fView])

  const activeFilters = [fDept, fPriority, fStatus, fView].filter(Boolean).length + (q ? 1 : 0)
  const clearFilters = () => { setQ(''); setFDept(''); setFPriority(''); setFStatus(''); setFView('') }

  const setProgress = async (row, progress) => {
    const patch = { progress }
    if (progress === 100 && row.status !== 'done') { patch.status = 'done'; patch.completed_at = new Date().toISOString() }
    else if (progress > 0 && progress < 100 && ['open'].includes(row.status)) patch.status = 'in_progress'
    else if (progress === 0 && row.status === 'done') { patch.status = 'open'; patch.completed_at = null }
    // Optimistic local update — no refetch, so the table stays put
    setLocalRows(effectiveRows.map((r) => r.id === row.id ? { ...r, ...patch } : r))
    try {
      const { error } = await supabase.from('work_orders').update(patch).eq('id', row.id)
      if (error) throw error
    } catch (e) { toast.error(e.message); setLocalRows(null); refresh() }
  }

  const save = async (payload) => {
    setSaving(true)
    try {
      if (payload.progress === 100 && payload.status !== 'cancelled') { payload.status = 'done'; payload.completed_at = new Date().toISOString() }
      if (drawer.row) { await update(drawer.row.id, payload); toast.success('Updated') }
      else { await insert(payload); toast.success('Created') }
      setDrawer({ open: false, row: null })
    } catch (e) { toast.error(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const del = async (row) => {
    if (!window.confirm(`Delete ${row.wo_number}?`)) return
    try { await remove(row.id); toast.success('Deleted') } catch (e) { toast.error(e.message) }
  }

  const fields = [
    { key: 'wo_number', label: at('WO number'), required: true },
    { key: 'title', label: at('Title'), required: true, span: true },
    { key: 'wo_type', label: at('Type'), type: 'select', options: TYPE.map((s) => ({ value: s, label: s })), default: 'corrective' },
    { key: 'priority', label: at('Priority'), type: 'select', options: PRIORITY.map((s) => ({ value: s, label: s })), default: 'medium' },
    { key: 'status', label: at('Status'), type: 'select', options: STATUS.map((s) => ({ value: s, label: s })), default: 'open' },
    { key: 'progress', label: at('Progress %'), type: 'number', default: 0 },
    { key: 'assigned_to', label: at('Assigned to') },
    { key: 'department', label: at('Department'), type: 'select', options: deptOptions },
    { key: 'due_date', label: at('Due date'), type: 'date' },
    { key: 'description', label: at('Description'), type: 'textarea', span: true },
  ]

  const open    = effectiveRows.filter((r) => ['open','in_progress','on_hold'].includes(r.status)).length
  const overdue = effectiveRows.filter((r) => { const d = daysUntil(r.due_date); return d != null && d < 0 && !['done', at('cancelled')].includes(r.status) }).length
  const urgent  = effectiveRows.filter((r) => r.priority === 'urgent' && r.status !== 'done').length
  const done    = effectiveRows.filter((r) => r.status === 'done').length

  return (
    <>
      <PageHeader eyebrow="Operations" title="Work Orders">
        {canWrite && (
          <button className="btn-primary" onClick={() => setDrawer({ open: true, row: null })}>
            <Plus size={16} /> New work order
          </button>
        )}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open" value={open} icon={ClipboardList} />
        <StatCard label="Overdue" value={overdue} tone={overdue ? 'bad' : 'ok'} icon={Clock} />
        <StatCard label="Urgent" value={urgent} tone={urgent ? 'bad' : 'ok'} icon={AlertTriangle} />
        <StatCard label="Completed" value={done} tone="ok" icon={CheckCircle2} />
      </div>

      {/* ── Filter bar ── */}
      <div className="panel mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-1.5">
            <Search size={15} className="text-ice-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={at('Search…')}
              className="w-40 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
          </div>
          <div className="flex items-center gap-1.5 text-ice-faint"><Filter size={14} /></div>
          <div className="w-40"><Select value={fView} onChange={(e) => setFView(e.target.value)}
            options={[{value:'',label: at('All work orders')},{value:'uncompleted',label: at('Uncompleted')},{value:'overdue',label: at('Overdue')},{value:'due_soon',label: at('Due within 3 days')},{value:'unassigned',label: at('Unassigned')}]} /></div>
          <div className="w-36"><Select value={fDept} onChange={(e) => setFDept(e.target.value)}
            options={[{value:'',label: at('All depts')}, ...deptOptions]} /></div>
          <div className="w-32"><Select value={fPriority} onChange={(e) => setFPriority(e.target.value)}
            options={[{value:'',label: at('Any priority')}, ...PRIORITY.map((s) => ({ value: s, label: s }))]} /></div>
          <div className="w-36"><Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}
            options={[{value:'',label: at('Any status')}, ...STATUS.map((s) => ({ value: s, label: s.replace('_',' ') }))]} /></div>
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="btn-ghost btn-sm ml-auto">
              <X size={13} /> Clear ({activeFilters})
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} of {rows.length}</span>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="panel overflow-hidden">
        {loading ? (
          <div className="space-y-px p-3">{Array.from({length:5}).map((_,i) => <div key={i} className="h-11 animate-pulse rounded bg-white/[0.03]" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title={rows.length ? 'No work orders match these filters' : 'No work orders yet'}
            hint={rows.length ? 'Try clearing or adjusting the filters above.' : 'Raise preventive, corrective, and inspection jobs against your assets.'}
            action={activeFilters > 0 ? <button className="btn-ghost btn-sm" onClick={clearFilters}>{at('Clear filters')}</button> : null} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="th">{at('WO #')}</th><th className="th">{at('Title')}</th><th className="th">{at('Type')}</th>
                  <th className="th">{at('Priority')}</th><th className="th">{at('Assigned')}</th><th className="th">{at('Due')}</th>
                  <th className="th">{at('Progress')}</th><th className="th">{at('Status')}</th>
                  {canWrite && <th className="th text-right">{at('Actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const d = daysUntil(r.due_date)
                  const overdueRow = d != null && d < 0 && !['done', at('cancelled')].includes(r.status)
                  return (
                    <tr key={r.id} className="transition hover:bg-white/[0.025]">
                      <td className="td font-mono text-accent whitespace-nowrap">{r.wo_number}</td>
                      <td className="td">{r.title}</td>
                      <td className="td"><Badge>{r.wo_type}</Badge></td>
                      <td className="td"><Badge tone={r.priority === 'urgent' || r.priority === 'high' ? 'bad' : 'mute'}>{r.priority}</Badge></td>
                      <td className="td whitespace-nowrap">{r.assigned_to || <span className="text-ice-faint">—</span>}</td>
                      <td className="td whitespace-nowrap"><span className={overdueRow ? 'text-bad' : d != null && d <= 2 ? 'text-warn' : ''}>{date(r.due_date)}</span></td>
                      <td className="td"><ProgressCell value={r.progress} disabled={!canWrite} onCommit={(v) => setProgress(r, v)} /></td>
                      <td className="td"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                      {canWrite && (
                        <td className="td text-right">
                          <div className="inline-flex gap-1">
                            <button onClick={() => setDrawer({ open: true, row: r })} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><Pencil size={14} /></button>
                            <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={drawer.open} onClose={() => setDrawer({ open: false, row: null })}
        title={drawer.row ? 'Edit Work Order' : 'New work order'}
        fields={fields} initial={drawer.row || empty} onSubmit={save} submitting={saving} />
    </>
  )
}
