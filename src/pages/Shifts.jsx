import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, Field, Select, useToast, EmptyState } from '../components/ui'
import { buildShiftContext, shiftOn } from '../lib/shifts'
import { CalendarClock, Users, Repeat, Plus, X, ChevronLeft, ChevronRight, Sun, Moon, Ban, Search } from 'lucide-react'

const SHIFTS = ['day', 'night', 'off']
const SHIFT_META = {
  day:   { label: 'D', color: '#F59E0B', title: 'Day shift' },
  night: { label: 'N', color: '#60A5FA', title: 'Night shift' },
  off:   { label: '—', color: '#94A3B8', title: 'Off' },
}
const iso = (d) => d.toISOString().slice(0, 10)

function Tabs({ tab, setTab }) {
  const items = [['roster', 'Roster'], ['assign', 'Assignments'], ['patterns', 'Patterns']]
  return (
    <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>{l}</button>
      ))}
    </div>
  )
}

// ── Pattern editor with cycle builder ────────────────────────────────────────
function Patterns() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { rows, loading, refresh } = useTable('shift_patterns')
  const [form, setForm] = useState({ name: '', anchor_date: iso(new Date()), cycle: ['day', 'day', 'day', 'day', 'day', 'off', 'off'] })
  const [saving, setSaving] = useState(false)
  const canWrite = ['owner', 'admin', 'manager', 'supervisor'].includes(role)

  const setCycleAt = (i, v) => setForm((f) => ({ ...f, cycle: f.cycle.map((c, idx) => idx === i ? v : c) }))
  const addStep = () => setForm((f) => ({ ...f, cycle: [...f.cycle, 'day'] }))
  const removeStep = (i) => setForm((f) => ({ ...f, cycle: f.cycle.filter((_, idx) => idx !== i) }))

  const save = async () => {
    if (!form.name || form.cycle.length === 0) { toast.error('Name and at least one cycle step required'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('shift_patterns').insert({ org_id: activeOrgId, name: form.name, anchor_date: form.anchor_date, cycle: form.cycle })
      if (error) throw error
      toast.success('Pattern created'); setForm({ name: '', anchor_date: iso(new Date()), cycle: ['day', 'day', 'day', 'day', 'day', 'off', 'off'] }); refresh()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const del = async (r) => { if (!window.confirm(`Delete pattern "${r.name}"? Assignments using it will stop resolving.`)) return; await supabase.from('shift_patterns').delete().eq('id', r.id); refresh() }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canWrite && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">New pattern</div>
          <div className="space-y-3">
            <Field label="Pattern name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 4x4 Day/Night" /></Field>
            <Field label="Anchor date (cycle day 1)"><input className="input" type="date" value={form.anchor_date} onChange={(e) => setForm({ ...form, anchor_date: e.target.value })} /></Field>
            <div>
              <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-ice-faint">Cycle ({form.cycle.length} days, repeats)</div>
              <div className="flex flex-wrap gap-1.5">
                {form.cycle.map((c, i) => (
                  <div key={i} className="flex items-center gap-0.5">
                    <button onClick={() => setCycleAt(i, SHIFTS[(SHIFTS.indexOf(c) + 1) % SHIFTS.length])}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 font-mono text-xs font-bold"
                      style={{ background: `${SHIFT_META[c].color}22`, color: SHIFT_META[c].color }} title={`Day ${i + 1}: ${SHIFT_META[c].title} — click to cycle`}>
                      {SHIFT_META[c].label}
                    </button>
                    <button onClick={() => removeStep(i)} className="text-ice-faint hover:text-bad"><X size={11} /></button>
                  </div>
                ))}
                <button onClick={addStep} className="grid h-9 w-9 place-items-center rounded-lg border border-dashed border-white/15 text-ice-faint hover:text-ice"><Plus size={14} /></button>
              </div>
              <p className="mt-1.5 text-[11px] text-ice-faint">Click a tile to cycle Day → Night → Off. The sequence repeats from the anchor date.</p>
            </div>
            <button onClick={save} disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Create pattern'}</button>
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-2.5"><span className="eyebrow">Existing patterns</span></div>
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : rows.length === 0 ? <EmptyState title="No patterns" hint="Create a shift cycle to assign to employees." />
        : rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ice">{r.name}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(r.cycle || []).map((c, i) => (
                  <span key={i} className="grid h-5 w-5 place-items-center rounded font-mono text-[9px] font-bold" style={{ background: `${SHIFT_META[c]?.color}22`, color: SHIFT_META[c]?.color }}>{SHIFT_META[c]?.label}</span>
                ))}
              </div>
            </div>
            {canWrite && <button onClick={() => del(r)} className="text-ice-faint hover:text-bad"><X size={14} /></button>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Assignments ──────────────────────────────────────────────────────────────
function Assignments() {
  const { role } = useAuth()
  const toast = useToast()
  const { rows: patterns } = useTable('shift_patterns')
  const { rows: employees } = useTable('employees')
  const { rows, loading, insert, remove } = useTable('employee_shift_assignments')
  const [form, setForm] = useState({ employee_id: '', pattern_id: '', effective_from: iso(new Date()) })
  const canWrite = ['owner', 'admin', 'manager', 'supervisor'].includes(role)

  const empName = (id) => employees.find((e) => e.id === id)?.full_name || '—'
  const patName = (id) => patterns.find((p) => p.id === id)?.name || '—'

  const save = async () => {
    if (!form.employee_id || !form.pattern_id) { toast.error('Pick an employee and a pattern'); return }
    try { await insert(form); toast.success('Assigned'); setForm({ employee_id: '', pattern_id: '', effective_from: iso(new Date()) }) }
    catch (e) { toast.error(e.message) }
  }
  const del = async (r) => { if (!window.confirm(`Remove ${empName(r.employee_id)}'s assignment?`)) return; try { await remove(r.id) } catch (e) { toast.error(e.message) } }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canWrite && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">Assign a pattern</div>
          <div className="space-y-3">
            <Field label="Employee"><Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} options={[{ value: '', label: 'Select…' }, ...employees.map((e) => ({ value: e.id, label: e.full_name }))]} /></Field>
            <Field label="Pattern"><Select value={form.pattern_id} onChange={(e) => setForm({ ...form, pattern_id: e.target.value })} options={[{ value: '', label: 'Select…' }, ...patterns.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
            <Field label="Effective from"><input className="input" type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
            <button onClick={save} className="btn-primary w-full">Assign pattern</button>
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">A newer assignment (later effective date) supersedes the previous one from that date onward.</p>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-2.5"><span className="eyebrow">Current assignments</span></div>
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : rows.length === 0 ? <EmptyState title="No assignments" hint="Assign employees to a pattern; their off days flow into Leave and Catering." />
        : (
          <div className="max-h-[420px] overflow-y-auto">
            {[...rows].sort((a, b) => empName(a.employee_id).localeCompare(empName(b.employee_id))).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-ice">{empName(r.employee_id)}</span>
                  <span className="ml-2"><Badge>{patName(r.pattern_id)}</Badge></span>
                </div>
                <span className="font-mono text-[11px] text-ice-faint">from {r.effective_from}</span>
                {canWrite && <button onClick={() => del(r)} className="text-ice-faint hover:text-bad"><X size={14} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Roster: month grid per employee, click a cell to override ────────────────
function Roster() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { rows: employees } = useTable('employees')
  const { rows: patterns } = useTable('shift_patterns')
  const { rows: assignments } = useTable('employee_shift_assignments')
  const { options: deptOptions } = useDepartments()
  const [overrides, setOverrides] = useState([])
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [savingCell, setSavingCell] = useState(null)
  const [dept, setDept] = useState('')
  const [patternFilter, setPatternFilter] = useState('')
  const [search, setSearch] = useState('')
  const canWrite = ['owner', 'admin', 'manager', 'supervisor'].includes(role)

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => iso(new Date(Date.UTC(cursor.y, cursor.m, i + 1))))
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const todayISO = iso(new Date())

  const loadOverrides = () => {
    if (!activeOrgId) return
    supabase.from('shift_overrides').select('*').eq('org_id', activeOrgId)
      .gte('shift_date', monthDates[0]).lte('shift_date', monthDates[monthDates.length - 1])
      .then(({ data }) => setOverrides(data || []))
  }
  useEffect(loadOverrides, [activeOrgId, cursor.y, cursor.m])

  const cycleOverride = async (emp, dateISO, current) => {
    if (!canWrite) return
    const next = SHIFTS[(SHIFTS.indexOf(current || 'day') + 1) % SHIFTS.length]
    const cellKey = `${emp.id}:${dateISO}`
    setSavingCell(cellKey)
    try {
      const { error } = await supabase.from('shift_overrides').upsert(
        { org_id: activeOrgId, employee_id: emp.id, shift_date: dateISO, shift: next, reason: 'manual' },
        { onConflict: 'employee_id,shift_date' })
      if (error) throw error
      // Optimistic local update so the change shows instantly
      setOverrides((prev) => {
        const rest = prev.filter((o) => !(o.employee_id === emp.id && o.shift_date === dateISO))
        return [...rest, { org_id: activeOrgId, employee_id: emp.id, shift_date: dateISO, shift: next, reason: 'manual' }]
      })
      toast.success(`${emp.full_name} · ${new Date(dateISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} → ${next}`)
    } catch (e) { toast.error(e.message) } finally { setTimeout(() => setSavingCell(null), 400) }
  }

  const clearOverride = async (emp, dateISO) => {
    if (!canWrite) return
    try {
      await supabase.from('shift_overrides').delete().eq('employee_id', emp.id).eq('shift_date', dateISO)
      setOverrides((prev) => prev.filter((o) => !(o.employee_id === emp.id && o.shift_date === dateISO)))
      toast.success('Override cleared — back to pattern')
    } catch (e) { toast.error(e.message) }
  }

  const move = (delta) => setCursor((c) => { const nm = c.m + delta; return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 } })

  // Filters: only assigned employees, then dept / pattern / name search
  const assignedIds = new Set(assignments.map((a) => a.employee_id))
  const patternIdsForFilter = patternFilter ? new Set(assignments.filter((a) => a.pattern_id === patternFilter).map((a) => a.employee_id)) : null
  const assigned = employees.filter((e) => assignedIds.has(e.id)
    && (!dept || e.department === dept)
    && (!patternFilter || patternIdsForFilter.has(e.id))
    && (!search || (e.full_name || '').toLowerCase().includes(search.toLowerCase())))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => move(-1)} className="btn-ghost btn-sm"><ChevronLeft size={15} /></button>
        <span className="min-w-[150px] text-center font-display text-lg font-bold text-ice">{monthName}</span>
        <button onClick={() => move(1)} className="btn-ghost btn-sm"><ChevronRight size={15} /></button>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-ice-faint">
          <span className="flex items-center gap-1"><Sun size={11} style={{ color: SHIFT_META.day.color }} /> Day</span>
          <span className="flex items-center gap-1"><Moon size={11} style={{ color: SHIFT_META.night.color }} /> Night</span>
          <span className="flex items-center gap-1"><Ban size={11} className="text-ice-faint" /> Off</span>
        </div>
      </div>

      {/* Filters */}
      <div className="panel mb-3 flex flex-wrap items-center gap-2 p-3">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ice-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee…" className="input pl-8" />
        </div>
        <div className="w-44"><Select value={dept} onChange={(e) => setDept(e.target.value)} options={[{ value: '', label: 'All departments' }, ...deptOptions]} /></div>
        <div className="w-44"><Select value={patternFilter} onChange={(e) => setPatternFilter(e.target.value)} options={[{ value: '', label: 'All patterns' }, ...patterns.map((p) => ({ value: p.id, label: p.name }))]} /></div>
        <span className="font-mono text-[11px] text-ice-faint">{assigned.length} shown</span>
      </div>

      {canWrite && <p className="mb-2 text-[11px] text-ice-faint">Click a cell to cycle Day → Night → Off (saves instantly). Right-click an override to clear it back to the pattern.</p>}

      {assigned.length === 0 ? <EmptyState title="No employees to show" hint={assignedIds.size === 0 ? 'Assign employees to a pattern in the Assignments tab first.' : 'No employees match these filters.'} />
      : (
        <div className="panel overflow-x-auto p-3">
          <table className="w-full border-collapse">
            <thead><tr>
              <th className="px-2 py-1 text-left font-mono text-[10px] uppercase text-ice-faint">Employee</th>
              {monthDates.map((d) => {
                const dow = new Date(d).getDay()
                return <th key={d} className={`px-0.5 py-1 text-center font-mono text-[9px] ${d === todayISO ? 'text-accent' : (dow === 0 || dow === 6) ? 'text-ice-faint/50' : 'text-ice-faint'}`}>{Number(d.slice(8))}</th>
              })}
            </tr></thead>
            <tbody>
              {assigned.map((emp) => {
                const ctx = buildShiftContext(emp.id, assignments, patterns, overrides)
                return (
                  <tr key={emp.id}>
                    <td className="px-2 py-0.5 text-xs text-ice whitespace-nowrap">{emp.full_name}</td>
                    {monthDates.map((d) => {
                      const s = shiftOn(ctx, d)
                      const meta = SHIFT_META[s] || { label: '·', color: '#1e293b' }
                      const isOverride = ctx.overrides.has(d)
                      const cellKey = `${emp.id}:${d}`
                      return (
                        <td key={d} className="p-0.5">
                          <button onClick={() => cycleOverride(emp, d, s)}
                            onContextMenu={(e) => { if (isOverride) { e.preventDefault(); clearOverride(emp, d) } }}
                            disabled={!canWrite}
                            className={`grid h-6 w-6 place-items-center rounded font-mono text-[9px] font-bold transition ${isOverride ? 'ring-1 ring-accent' : ''} ${savingCell === cellKey ? 'scale-125' : ''} ${d === todayISO ? 'outline outline-1 outline-accent/40' : ''}`}
                            style={{ background: `${meta.color}26`, color: meta.color }}
                            title={`${emp.full_name} · ${d} · ${s || 'no pattern'}${isOverride ? ' (override — right-click to clear)' : ''}`}>
                            {meta.label}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Shifts() {
  const { activeOrgId } = useAuth()
  const [tab, setTab] = useState('roster')
  const [counts, setCounts] = useState({ patterns: 0, assigned: 0 })

  // Live summary — refetched whenever the tab changes so it never goes stale
  useEffect(() => {
    if (!activeOrgId) return
    Promise.all([
      supabase.from('shift_patterns').select('id').eq('org_id', activeOrgId),
      supabase.from('employee_shift_assignments').select('employee_id').eq('org_id', activeOrgId),
    ]).then(([p, a]) => {
      setCounts({
        patterns: (p.data || []).length,
        assigned: new Set((a.data || []).map((x) => x.employee_id)).size,
      })
    })
  }, [activeOrgId, tab])

  return (
    <div>
      <PageHeader eyebrow="People" title="Shift System" />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Patterns" value={counts.patterns} icon={Repeat} />
        <StatCard label="Assigned employees" value={counts.assigned} icon={Users} />
        <StatCard label="Roster" value="Monthly" icon={CalendarClock} sub="click cells to override" />
      </div>
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'patterns' && <Patterns />}
      {tab === 'assign' && <Assignments />}
      {tab === 'roster' && <Roster />}
    </div>
  )
}
