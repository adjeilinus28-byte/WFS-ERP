import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, Field, Select, useToast, EmptyState } from '../components/ui'
import { buildShiftContext, shiftOn } from '../lib/shifts'
import { businessMonthRange, currentBusinessMonth, businessMonthLabel } from '../lib/period'
import { ghanaHolidays, HOLIDAY_TYPES } from '../lib/holidays'
import { CalendarClock, Users, Repeat, Plus, X, ChevronLeft, ChevronRight, Sun, Moon, Ban, Search, CalendarDays, Pencil } from 'lucide-react'

const SHIFTS = ['day', 'night', 'off']
const SHIFT_META = {
  day:   { label: 'D', color: '#F59E0B', title: 'Day shift' },
  night: { label: 'N', color: '#60A5FA', title: 'Night shift' },
  off:   { label: '—', color: '#94A3B8', title: 'Off' },
}
const iso = (d) => d.toISOString().slice(0, 10)

function Tabs({ tab, setTab }) {
  const items = [['roster', 'Roster'], ['assign', 'Assignments'], ['patterns', 'Patterns'], ['holidays', 'Holidays']]
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
  const BLANK = { name: '', anchor_date: iso(new Date()), cycle: ['day', 'day', 'day', 'day', 'day', 'off', 'off'] }
  const [form, setForm] = useState(BLANK)
  const [editing, setEditing] = useState(null)      // pattern row being edited
  const [original, setOriginal] = useState(null)    // snapshot to detect cycle/anchor changes
  const [saving, setSaving] = useState(false)
  const { can: _can_people } = usePermissions()
  const canWrite = _can_people('people', 'edit')

  const setCycleAt = (i, v) => setForm((f) => ({ ...f, cycle: f.cycle.map((c, idx) => idx === i ? v : c) }))
  const addStep = () => setForm((f) => ({ ...f, cycle: [...f.cycle, 'day'] }))
  const removeStep = (i) => setForm((f) => ({ ...f, cycle: f.cycle.filter((_, idx) => idx !== i) }))

  const startEdit = (r) => {
    setEditing(r)
    setOriginal({ anchor_date: r.anchor_date, cycle: JSON.stringify(r.cycle || []) })
    setForm({ name: r.name || '', anchor_date: r.anchor_date || iso(new Date()), cycle: Array.isArray(r.cycle) ? [...r.cycle] : [] })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancelEdit = () => { setEditing(null); setOriginal(null); setForm(BLANK) }

  const save = async () => {
    if (!form.name || form.cycle.length === 0) { toast.error('Name and at least one cycle step required'); return }
    setSaving(true)
    try {
      if (editing) {
        // Changing the cycle or anchor changes how attendance, R&R days and any
        // REGENERATED past payslips are computed. Warn before touching those.
        const payAffecting = original && (original.anchor_date !== form.anchor_date || original.cycle !== JSON.stringify(form.cycle))
        if (payAffecting && !window.confirm(
          'You are changing the cycle or anchor date.\n\nThis changes how working days and R&R (off) days are counted for everyone on this pattern — including past periods if a payslip is regenerated. Already-issued payslips keep their saved figures.\n\nContinue?')) {
          setSaving(false); return
        }
        const { error } = await supabase.from('shift_patterns')
          .update({ name: form.name, anchor_date: form.anchor_date, cycle: form.cycle })
          .eq('id', editing.id)
        if (error) throw error
        toast.success('Pattern updated'); cancelEdit(); refresh(); setSaving(false); return
      }
      const { error } = await supabase.from('shift_patterns').insert({ org_id: activeOrgId, name: form.name, anchor_date: form.anchor_date, cycle: form.cycle })
      if (error) throw error
      toast.success('Pattern created'); setForm({ name: '', anchor_date: iso(new Date()), cycle: ['day', 'day', 'day', 'day', 'day', 'off', 'off'] }); refresh()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  // Deleting a pattern that employees are assigned to would break their roster
  // (and their attendance-driven pay), so block it and say how many are affected.
  const del = async (r) => {
    try {
      const { count, error: cErr } = await supabase
        .from('employee_shift_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', activeOrgId).eq('pattern_id', r.id)
      if (cErr) throw cErr
      if ((count || 0) > 0) {
        toast.error(`"${r.name}" is assigned to ${count} employee${count === 1 ? '' : 's'}. Reassign them to another pattern first.`)
        return
      }
      if (!window.confirm(`Delete pattern "${r.name}"? This cannot be undone.`)) return
      const { error } = await supabase.from('shift_patterns').delete().eq('id', r.id)
      if (error) throw error
      if (editing?.id === r.id) cancelEdit()
      toast.success('Pattern deleted'); refresh()
    } catch (e) { toast.error(e.message || 'Delete failed') }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canWrite && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">{editing ? `Edit pattern — ${editing.name}` : 'New pattern'}</div>
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
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create pattern'}
              </button>
              {editing && (
                <button onClick={cancelEdit} disabled={saving} className="btn-ghost">Cancel</button>
              )}
            </div>
            {editing && (
              <p className="mt-2 text-[11px] text-warn">⚠ Changing the cycle or anchor date affects how working and R&R days are counted for everyone on this pattern.</p>
            )}
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-2.5"><span className="eyebrow">Existing patterns</span></div>
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : rows.length === 0 ? <EmptyState title="No patterns" hint="Create a shift cycle to assign to employees." />
        : rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 ${editing?.id === r.id ? 'bg-accent/[0.06]' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ice">{r.name}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(r.cycle || []).map((c, i) => (
                  <span key={i} className="grid h-5 w-5 place-items-center rounded font-mono text-[9px] font-bold" style={{ background: `${SHIFT_META[c]?.color}22`, color: SHIFT_META[c]?.color }}>{SHIFT_META[c]?.label}</span>
                ))}
              </div>
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => startEdit(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/[0.06] hover:text-ice" title="Edit pattern"><Pencil size={13} /></button>
                <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad" title="Delete pattern"><X size={14} /></button>
              </div>
            )}
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
  const { can: _can_people } = usePermissions()
  const canWrite = _can_people('people', 'edit')

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
                {canWrite && (
<button onClick={() => del(r)} className="text-ice-faint hover:text-bad"><X size={14} /></button>
            )}
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
  const [holidays, setHolidays] = useState([])
  const [absences, setAbsences] = useState([])
  const [mode, setMode] = useState('shifts')   // shifts | attendance
  const [cursor, setCursor] = useState(() => { const b = currentBusinessMonth(); return { y: b.year, m: b.month } })
  const [savingCell, setSavingCell] = useState(null)
  const [dept, setDept] = useState('')
  const [patternFilter, setPatternFilter] = useState('')
  const [search, setSearch] = useState('')
  const { can: _can_people } = usePermissions()
  const canWrite = _can_people('people', 'edit')

  // Business month: cursor.{y,m} is the ENDING month; range = 21st prev → 20th current
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const { start: bStart, end: bEnd } = businessMonthRange(cursor.y, cursor.m)
  const monthDates = (() => { const out = []; const d = new Date(bStart); while (d <= bEnd) { out.push(isoLocal(d)); d.setDate(d.getDate() + 1) } return out })()
  const monthName = businessMonthLabel(`${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`)
  const rangeLabel = `${bStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${bEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  const todayISO = iso(new Date())

  const loadOverrides = () => {
    if (!activeOrgId) return
    const first = monthDates[0], last = monthDates[monthDates.length - 1]
    supabase.from('shift_overrides').select('*').eq('org_id', activeOrgId)
      .gte('shift_date', first).lte('shift_date', last)
      .then(({ data }) => setOverrides(data || []))
    supabase.from('holidays').select('*').eq('org_id', activeOrgId)
      .gte('holiday_date', first).lte('holiday_date', last)
      .then(({ data }) => setHolidays(data || []))
    supabase.from('shift_absences').select('*').eq('org_id', activeOrgId)
      .gte('absence_date', first).lte('absence_date', last)
      .then(({ data }) => setAbsences(data || []))
  }
  useEffect(loadOverrides, [activeOrgId, cursor.y, cursor.m])

  const holidayOn = (dateISO) => holidays.find((h) => h.holiday_date === dateISO)
  const isAbsent = (empId, dateISO) => absences.some((a) => a.employee_id === empId && a.absence_date === dateISO)

  const toggleAbsence = async (emp, dateISO, shift) => {
    if (!canWrite) return
    if (shift === 'off' || shift == null) { toast.error('Can only mark absence on a working (Day/Night) shift'); return }
    const existing = absences.find((a) => a.employee_id === emp.id && a.absence_date === dateISO)
    try {
      if (existing) {
        await supabase.from('shift_absences').delete().eq('id', existing.id)
        setAbsences((p) => p.filter((a) => a.id !== existing.id))
        toast.success(`${emp.full_name} marked present`)
      } else {
        const { data, error } = await supabase.from('shift_absences').insert({ org_id: activeOrgId, employee_id: emp.id, absence_date: dateISO }).select().single()
        if (error) throw error
        setAbsences((p) => [...p, data])
        toast.success(`${emp.full_name} marked absent · ${new Date(dateISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)
      }
    } catch (e) { toast.error(e.message) }
  }

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
        <span className="min-w-[150px] text-center font-display text-lg font-bold text-ice">{monthName}<span className="ml-2 font-mono text-[11px] font-normal text-ice-faint">{rangeLabel}</span></span>
        <button onClick={() => move(1)} className="btn-ghost btn-sm"><ChevronRight size={15} /></button>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-ice-faint">
          <span className="flex items-center gap-1"><Sun size={11} style={{ color: SHIFT_META.day.color }} /> Day</span>
          <span className="flex items-center gap-1"><Moon size={11} style={{ color: SHIFT_META.night.color }} /> Night</span>
          <span className="flex items-center gap-1"><Ban size={11} className="text-ice-faint" /> Off</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Holiday</span>
          <span className="flex items-center gap-1"><span className="grid h-3 w-3 place-items-center rounded-sm text-[7px] font-bold text-bad ring-1 ring-bad">A</span> Absent</span>
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
        {canWrite && (
          <div className="inline-flex rounded-lg border border-white/10 bg-navy/60 p-0.5">
            <button onClick={() => setMode('shifts')} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${mode === 'shifts' ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>Shifts</button>
            <button onClick={() => setMode('attendance')} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${mode === 'attendance' ? 'bg-bad text-white' : 'text-ice-dim hover:text-ice'}`}>Attendance</button>
          </div>
        )}
        <span className="font-mono text-[11px] text-ice-faint">{assigned.length} shown</span>
      </div>

      {canWrite && (
        <p className="mb-2 text-[11px] text-ice-faint">
          {mode === 'shifts'
            ? 'Shifts mode: click a cell to cycle Day → Night → Off (saves instantly). Right-click an override to clear it back to the pattern.'
            : 'Attendance mode: click a working (Day/Night) cell to toggle Absent (red A). Amber-dotted days are holidays.'}
        </p>
      )}

      {assigned.length === 0 ? <EmptyState title="No employees to show" hint={assignedIds.size === 0 ? 'Assign employees to a pattern in the Assignments tab first.' : 'No employees match these filters.'} />
      : (
        <div className="panel overflow-x-auto p-3">
          <table className="w-full border-collapse">
            <thead><tr>
              <th className="px-2 py-1 text-left font-mono text-[10px] uppercase text-ice-faint">Employee</th>
              {monthDates.map((d) => {
                const dow = new Date(d).getDay()
                const isFirst = d.slice(8) === '01'
                const hol = holidayOn(d)
                return <th key={d} title={hol ? hol.name : ''} className={`px-0.5 py-1 text-center font-mono text-[9px] ${isFirst ? 'border-l border-white/15' : ''} ${hol ? 'bg-accent/10' : ''} ${d === todayISO ? 'text-accent' : (dow === 0 || dow === 6) ? 'text-ice-faint/50' : 'text-ice-faint'}`}>
                  {Number(d.slice(8))}
                  {hol && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-accent" />}
                </th>
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
                      const isFirst = d.slice(8) === '01'
                      const hol = holidayOn(d)
                      const absent = isAbsent(emp.id, d)
                      const onClick = () => mode === 'attendance' ? toggleAbsence(emp, d, s) : cycleOverride(emp, d, s)
                      return (
                        <td key={d} className={`p-0.5 ${isFirst ? 'border-l border-white/15' : ''} ${hol ? 'bg-accent/[0.06]' : ''}`}>
                          <button onClick={onClick}
                            onContextMenu={(e) => { if (mode === 'shifts' && isOverride) { e.preventDefault(); clearOverride(emp, d) } }}
                            disabled={!canWrite}
                            className={`grid h-6 w-6 place-items-center rounded font-mono text-[9px] font-bold transition ${isOverride ? 'ring-1 ring-accent' : ''} ${absent ? 'ring-2 ring-bad' : ''} ${savingCell === cellKey ? 'scale-125' : ''} ${d === todayISO ? 'outline outline-1 outline-accent/40' : ''}`}
                            style={absent ? { background: '#dc262633', color: '#f87171' } : { background: `${meta.color}26`, color: meta.color }}
                            title={`${emp.full_name} · ${d} · ${absent ? 'ABSENT' : (s || 'no pattern')}${hol ? ' · ' + hol.name : ''}${isOverride ? ' (override)' : ''}`}>
                            {absent ? 'A' : meta.label}
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

// ── Holidays manager ─────────────────────────────────────────────────────────
function Holidays() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { rows, loading, insert, remove, refresh } = useTable('holidays', { order: { column: 'holiday_date', ascending: true } })
  const [year, setYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({ holiday_date: '', name: '', holiday_type: 'company' })
  const [busy, setBusy] = useState(false)
  const { can: _can_people } = usePermissions()
  const canWrite = _can_people('people', 'edit')

  const generate = async () => {
    setBusy(true)
    try {
      const gen = ghanaHolidays(year).map((h) => ({ ...h, org_id: activeOrgId }))
      const { error } = await supabase.from('holidays').upsert(gen, { onConflict: 'org_id,holiday_date,name', ignoreDuplicates: true })
      if (error) throw error
      toast.success(`Generated ${gen.length} holidays for ${year}`); refresh()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const add = async () => {
    if (!form.holiday_date || !form.name) { toast.error('Date and name required'); return }
    try { await insert({ ...form, source: 'manual', country: 'Ghana' }); toast.success('Holiday added'); setForm({ holiday_date: '', name: '', holiday_type: 'company' }) }
    catch (e) { toast.error(e.message.includes('duplicate') ? 'That holiday already exists' : e.message) }
  }
  const del = async (h) => { if (!window.confirm(`Delete "${h.name}"?`)) return; try { await remove(h.id) } catch (e) { toast.error(e.message) } }

  const shown = rows.filter((h) => h.holiday_date.startsWith(String(year)))
  const TONE = { public: 'accent', religious: 'ok', international: 'info', company: 'mute' }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canWrite && (
        <div className="panel p-5">
          <div className="eyebrow mb-3">Auto-generate</div>
          <div className="flex items-end gap-2">
            <Field label="Year"><input className="input w-28" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
            <button onClick={generate} disabled={busy} className="btn-primary"><CalendarDays size={15} /> {busy ? 'Generating…' : `Generate ${year}`}</button>
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">Adds Ghana public, religious, and international holidays. Fixed and Christian dates are exact; Islamic dates are estimates (marked "est.") — verify and edit below. Holidays are display-only and don't change any shift.</p>

          <div className="my-4 h-px bg-white/10" />
          <div className="eyebrow mb-3">Add manually</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input className="input" type="date" value={form.holiday_date} onChange={(e) => setForm({ ...form, holiday_date: e.target.value })} /></Field>
            <Field label="Type"><Select value={form.holiday_type} onChange={(e) => setForm({ ...form, holiday_type: e.target.value })} options={HOLIDAY_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
            <div className="col-span-2"><Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Company Founders Day" /></Field></div>
          </div>
          <button onClick={add} className="btn-primary btn-sm mt-3"><Plus size={14} /> Add holiday</button>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <span className="eyebrow">{year} holidays</span>
          <div className="flex gap-1">
            <button onClick={() => setYear(year - 1)} className="btn-ghost btn-sm"><ChevronLeft size={14} /></button>
            <button onClick={() => setYear(year + 1)} className="btn-ghost btn-sm"><ChevronRight size={14} /></button>
          </div>
        </div>
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : shown.length === 0 ? <EmptyState title={`No holidays for ${year}`} hint="Use auto-generate or add them manually." />
        : (
          <div className="max-h-[460px] overflow-y-auto">
            {shown.map((h) => (
              <div key={h.id} className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2.5">
                <div className="w-24 shrink-0 font-mono text-xs text-accent">{new Date(h.holiday_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                <div className="min-w-0 flex-1"><span className="text-sm text-ice">{h.name}</span></div>
                <Badge tone={TONE[h.holiday_type] || 'mute'}>{h.holiday_type}</Badge>
                {h.source === 'auto' && <Badge tone="mute">auto</Badge>}
                {canWrite && <button onClick={() => del(h)} className="text-ice-faint hover:text-bad"><X size={14} /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
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
      {tab === 'holidays' && <Holidays />}
    </div>
  )
}
