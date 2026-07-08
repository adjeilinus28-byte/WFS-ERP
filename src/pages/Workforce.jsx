import { useMemo, useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard, PageHeader, Select, EmptyState, useToast } from '../components/ui'
import { date } from '../lib/format'
import { useTable } from '../hooks/useTable'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import EmployeeEditor from '../components/EmployeeEditor'
import EmployeeProfile from '../components/EmployeeProfile'
import { Users, UserCheck, UserMinus, Hammer, Building2, Network, Plus, Search, Pencil, Trash2, X, Filter } from 'lucide-react'

const STATUS = ['active', 'leave', 'suspended', 'exited']
const WORKER = ['surface', 'underground', 'office', 'field']

function Tabs({ tab, setTab }) {
  const items = [['staff', 'Employees'], ['departments', 'Departments']]
  return (
    <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Employees() {
  const { role } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove } = useTable('employees')
  const [editor, setEditor] = useState({ open: false, row: null })
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const canWrite = role && role !== 'viewer'

  // Filters
  const [q, setQ] = useState('')
  const [fDept, setFDept] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fWorker, setFWorker] = useState('')
  const [fMarital, setFMarital] = useState('')

  const filtered = useMemo(() => rows.filter((r) => {
    if (q.trim()) {
      const n = q.toLowerCase()
      if (!['full_name','employee_no','position','department','email'].some((k) => String(r[k] ?? '').toLowerCase().includes(n))) return false
    }
    if (fDept && r.department !== fDept) return false
    if (fStatus && r.status !== fStatus) return false
    if (fWorker && r.worker_type !== fWorker) return false
    if (fMarital && r.marital_status !== fMarital) return false
    return true
  }), [rows, q, fDept, fStatus, fWorker, fMarital])

  const activeF = [fDept, fStatus, fWorker, fMarital].filter(Boolean).length + (q ? 1 : 0)
  const clear = () => { setQ(''); setFDept(''); setFStatus(''); setFWorker(''); setFMarital('') }

  const save = async (payload) => {
    setSaving(true)
    try {
      if (editor.row?.id) { await update(editor.row.id, payload); toast.success('Employee updated') }
      else { await insert(payload); toast.success('Employee added') }
      setEditor({ open: false, row: null })
    } catch (e) { toast.error(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const del = async (row) => {
    if (!window.confirm(`Delete ${row.full_name}?`)) return
    try { await remove(row.id); toast.success('Deleted'); setProfile(null) } catch (e) { toast.error(e.message) }
  }

  const active  = rows.filter((r) => r.status === 'active').length
  const onLeave = rows.filter((r) => r.status === 'leave').length
  const field   = rows.filter((r) => ['field','underground','surface'].includes(r.worker_type)).length

  return (
    <>
      <PageHeader eyebrow="People" title="Workforce">
        {canWrite && <button className="btn-primary" onClick={() => setEditor({ open: true, row: null })}><Plus size={16} /> New employee</button>}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Headcount" value={rows.length} icon={Users} />
        <StatCard label="Active" value={active} tone="ok" icon={UserCheck} />
        <StatCard label="On leave" value={onLeave} icon={UserMinus} />
        <StatCard label="Field / site" value={field} icon={Hammer} />
      </div>

      {/* Filter bar */}
      <div className="panel mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-1.5">
            <Search size={15} className="text-ice-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, no., role…"
              className="w-48 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
          </div>
          <Filter size={14} className="text-ice-faint" />
          <div className="w-36"><Select value={fDept} onChange={(e) => setFDept(e.target.value)} options={[{ value: '', label: 'All depts' }, ...deptOptions]} /></div>
          <div className="w-32"><Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} options={[{ value: '', label: 'Any status' }, ...STATUS.map((s) => ({ value: s, label: s }))]} /></div>
          <div className="w-36"><Select value={fWorker} onChange={(e) => setFWorker(e.target.value)} options={[{ value: '', label: 'Any type' }, ...WORKER.map((s) => ({ value: s, label: s }))]} /></div>
          <div className="w-36"><Select value={fMarital} onChange={(e) => setFMarital(e.target.value)} options={[{ value: '', label: 'Any marital' }, ...['single','married','divorced','widowed'].map((s) => ({ value: s, label: s }))]} /></div>
          {activeF > 0 && <button onClick={clear} className="btn-ghost btn-sm"><X size={13} /> Clear ({activeF})</button>}
          <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} of {rows.length}</span>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {loading ? (
          <div className="space-y-px p-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded bg-white/[0.03]" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title={rows.length ? 'No employees match these filters' : 'No employees'} hint={rows.length ? 'Adjust or clear the filters.' : 'Add your staff directory with full HR profiles.'}
            action={activeF ? <button className="btn-ghost btn-sm" onClick={clear}>Clear filters</button> : null} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.02]"><tr>
                <th className="th">No.</th><th className="th">Name</th><th className="th">Department</th>
                <th className="th">Position</th><th className="th">Type</th><th className="th">Status</th><th className="th">Hired</th>
                {canWrite && <th className="th text-right">Actions</th>}
              </tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="cursor-pointer transition hover:bg-white/[0.025]" onClick={() => setProfile(r)}>
                    <td className="td font-mono text-accent whitespace-nowrap">{r.employee_no || '—'}</td>
                    <td className="td">
                      <span className="font-medium text-ice hover:text-accent">{r.full_name}</span>
                    </td>
                    <td className="td">{r.department ? <Badge>{r.department}</Badge> : '—'}</td>
                    <td className="td whitespace-nowrap">{r.position || '—'}</td>
                    <td className="td">{r.worker_type ? <Badge>{r.worker_type}</Badge> : '—'}</td>
                    <td className="td"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="td whitespace-nowrap">{date(r.hired_on)}</td>
                    {canWrite && (
                      <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1">
                          <button onClick={() => setEditor({ open: true, row: r })} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><Pencil size={14} /></button>
                          <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EmployeeEditor open={editor.open} initial={editor.row} deptOptions={deptOptions}
        onClose={() => setEditor({ open: false, row: null })} onSubmit={save} submitting={saving} />

      <EmployeeProfile employee={profile} canWrite={canWrite}
        onClose={() => setProfile(null)}
        onEdit={(emp) => { setProfile(null); setEditor({ open: true, row: emp }) }} />
    </>
  )
}

export default function Workforce() {
  const [tab, setTab] = useState('staff')
  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'staff' ? <Employees /> : (
        <ModuleScaffold
          eyebrow="People" title="Departments" table="departments"
          newLabel="New department" emptyTitle="No departments yet"
          emptyHint="Define your org structure — these become the dropdown options across the platform."
          searchKeys={['name', 'code', 'head', 'cost_center']}
          columns={[
            { key: 'name', label: 'Department' },
            { key: 'code', label: 'Code', render: (v) => v ? <span className="font-mono text-accent">{v}</span> : '—' },
            { key: 'head', label: 'Head' },
            { key: 'cost_center', label: 'Cost centre', render: (v) => v ? <span className="font-mono">{v}</span> : '—' },
          ]}
          fields={[
            { key: 'name', label: 'Department name', required: true, span: true },
            { key: 'code', label: 'Code' },
            { key: 'head', label: 'Department head' },
            { key: 'head_email', label: 'Head email (incident + announcements)', type: 'email' },
            { key: 'supervisor_email', label: 'Supervisor email (announcements)', type: 'email' },
            { key: 'cost_center', label: 'Cost centre' },
          ]}
          kpis={(rows) => {
            const withHead = rows.filter((r) => r.head).length
            return <>
              <StatCard label="Departments" value={rows.length} icon={Building2} />
              <StatCard label="With a head" value={withHead} icon={Network} />
              <StatCard label="With cost centre" value={rows.filter((r) => r.cost_center).length} icon={Network} />
              <StatCard label="Unassigned" value={rows.length - withHead} tone={rows.length - withHead ? 'warn' : 'ok'} icon={Network} />
            </>
          }}
        />
      )}
    </div>
  )
}
