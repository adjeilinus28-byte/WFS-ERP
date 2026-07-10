import { useEffect, useMemo, useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard, PageHeader, Field, Select, useToast, EmptyState } from '../components/ui'
import Drawer from '../components/Drawer'
import DataTable from '../components/DataTable'
import { date, num } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { workingDays, noticeDays, isHoliday } from '../lib/workdays'
import { buildShiftContext, shiftAwareWorkingDays } from '../lib/shifts'
import {
  CalendarCheck, CalendarX, Users, Check, X, Plus, AlertTriangle, Clock, Wallet, Layers,
  ChevronLeft, ChevronRight, CalendarDays,
} from 'lucide-react'
import { at } from '../lib/tr'

const TABS = [['requests', at('Requests')], ['balances', at('Balances')], ['calendar', at('Calendar')], ['types', at('Leave Types')]]
const LEAVE_STATUS = ['pending', 'approved', 'declined', 'cancelled']

function TabStrip({ tab, setTab }) {
  return (
    <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
      {TABS.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Notify helper (Brevo via Netlify fn) ────────────────────────────────────
async function notify(org_id, request_id, event) {
  try {
    await fetch('/.netlify/functions/leave-notification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id, request_id, event }),
    })
  } catch (_) { /* non-blocking */ }
}

// ── Requests tab ─────────────────────────────────────────────────────────────
function Requests() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove, refresh } = useTable('leave_requests')
  const { rows: employees } = useTable('employees')
  const { rows: types } = useTable('leave_types')
  const [drawer, setDrawer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [decideRow, setDecideRow] = useState(null)
  const [note, setNote] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fDept, setFDept] = useState('')
  const canApprove = ['owner', 'admin', 'manager', 'supervisor'].includes(role)

  // Apply form state
  const [form, setForm] = useState({ employee_id: '', leave_type: '', start_date: '', end_date: '', reason: '' })
  const activeTypes = types.filter((t) => t.active !== false)

  const emp = employees.find((e) => e.id === form.employee_id)
  const lt = activeTypes.find((t) => t.name === form.leave_type)
  // Shift data — the working-day count respects the employee's off days
  const { rows: shiftPatterns } = useTable('shift_patterns')
  const { rows: shiftAssignments } = useTable('employee_shift_assignments')
  const [shiftOverrides, setShiftOverrides] = useState([])
  useEffect(() => {
    if (!form.employee_id || !form.start_date || !form.end_date) { setShiftOverrides([]); return }
    supabase.from('shift_overrides').select('*').eq('employee_id', form.employee_id)
      .gte('shift_date', form.start_date).lte('shift_date', form.end_date)
      .then(({ data }) => setShiftOverrides(data || []))
  }, [form.employee_id, form.start_date, form.end_date])

  const hasShiftPattern = shiftAssignments.some((a) => a.employee_id === form.employee_id)
  const wd = useMemo(() => {
    if (!form.start_date || !form.end_date) return 0
    if (form.employee_id && hasShiftPattern) {
      const ctx = buildShiftContext(form.employee_id, shiftAssignments, shiftPatterns, shiftOverrides)
      return shiftAwareWorkingDays(form.start_date, form.end_date, ctx, { isHoliday })
    }
    return workingDays(form.start_date, form.end_date)
  }, [form.start_date, form.end_date, form.employee_id, hasShiftPattern, shiftAssignments, shiftPatterns, shiftOverrides])
  const notice = noticeDays(form.start_date)
  const noticeOk = !lt || notice >= (lt.requires_notice_days || 0)

  // Clash detection: same employee, overlapping approved/pending dates
  const clash = useMemo(() => {
    if (!form.employee_id || !form.start_date || !form.end_date) return null
    return rows.find((r) => r.employee_id === form.employee_id
      && ['pending', at('approved')].includes(r.status)
      && !(new Date(r.end_date) < new Date(form.start_date) || new Date(r.start_date) > new Date(form.end_date)))
  }, [rows, form])

  const submitApply = async () => {
    if (!form.employee_id || !form.leave_type || !form.start_date || !form.end_date) { toast.error('Fill all required fields'); return }
    if (!noticeOk) { toast.error(`${lt.name} needs ${lt.requires_notice_days} days notice`); return }
    setSaving(true)
    try {
      const payload = {
        employee_id: form.employee_id, employee_name: emp?.full_name, department: emp?.department,
        leave_type: form.leave_type, start_date: form.start_date, end_date: form.end_date,
        days: wd, working_days: wd, reason: form.reason, status: 'pending',
      }
      const [created] = await insert(payload)
      if (created?.id) await notify(activeOrgId, created.id, 'submitted')
      toast.success('Leave request submitted — approvers notified')
      setDrawer(false); setForm({ employee_id: '', leave_type: '', start_date: '', end_date: '', reason: '' })
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const decide = async (status) => {
    if (!decideRow) return
    try {
      await update(decideRow.id, { status, decision_note: note, decided_at: new Date().toISOString() })
      await notify(activeOrgId, decideRow.id, status === 'approved' ? 'approved' : 'declined')
      toast.success(`Request ${status} — applicant notified`)
      setDecideRow(null); setNote('')
    } catch (e) { toast.error(e.message) }
  }

  const del = async (row) => {
    if (!window.confirm('Delete this leave request?')) return
    try { await remove(row.id); toast.success('Deleted') } catch (e) { toast.error(e.message) }
  }

  const filtered = rows.filter((r) => (!fStatus || r.status === fStatus) && (!fDept || r.department === fDept))
  const pending = rows.filter((r) => r.status === 'pending').length
  const approved = rows.filter((r) => r.status === 'approved').length
  const away = rows.filter((r) => { const now = new Date(); return r.status === 'approved' && new Date(r.start_date) <= now && new Date(r.end_date) >= now }).length

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div />
        <button className="btn-primary" onClick={() => setDrawer(true)}><Plus size={16} /> {at('Apply for leave')}</button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Pending" value={pending} tone={pending ? 'warn' : 'ok'} icon={CalendarX} />
        <StatCard label="Approved" value={approved} tone="ok" icon={CalendarCheck} />
        <StatCard label="Currently away" value={away} icon={Users} />
        <StatCard label="Total requests" value={rows.length} icon={Layers} />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="w-40"><Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} options={[{ value: '', label: at('All statuses') }, ...LEAVE_STATUS.map((s) => ({ value: s, label: s }))]} /></div>
        <div className="w-40"><Select value={fDept} onChange={(e) => setFDept(e.target.value)} options={[{ value: '', label: at('All depts') }, ...deptOptions]} /></div>
        <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} of {rows.length}</span>
      </div>

      <div className="panel overflow-hidden">
        {loading ? <div className="p-6 text-center text-ice-faint">{at('Loading…')}</div>
        : filtered.length === 0 ? <EmptyState title="No leave requests" hint="Submit a request with Apply for leave." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.02]"><tr>
                <th className="th">{at('Employee')}</th><th className="th">{at('Dept')}</th><th className="th">{at('Type')}</th>
                <th className="th">{at('From')}</th><th className="th">{at('To')}</th><th className="th">{at('Days')}</th>
                <th className="th">{at('Status')}</th><th className="th text-right">{at('Actions')}</th>
              </tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="transition hover:bg-white/[0.025]">
                    <td className="td">{r.employee_name}</td>
                    <td className="td">{r.department ? <Badge>{r.department}</Badge> : '—'}</td>
                    <td className="td"><Badge>{r.leave_type}</Badge></td>
                    <td className="td whitespace-nowrap">{date(r.start_date)}</td>
                    <td className="td whitespace-nowrap">{date(r.end_date)}</td>
                    <td className="td font-mono">{r.working_days ?? r.days}</td>
                    <td className="td"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="td text-right">
                      <div className="inline-flex gap-1">
                        {canApprove && r.status === 'pending' && (
                          <>
                            <button onClick={() => { setDecideRow(r); setNote('') }} className="rounded-md bg-ok/10 px-2 py-1 text-xs text-ok hover:bg-ok/20">{at('Review')}</button>
                          </>
                        )}
                        {canApprove && <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><X size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Apply drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">{at('Apply for Leave')}</h2>
              <button onClick={() => setDrawer(false)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Employee *"><Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} options={[{ value: '', label: at('Select…') }, ...employees.map((e) => ({ value: e.id, label: e.full_name }))]} /></Field>
              <Field label="Leave type *"><Select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })} options={[{ value: '', label: at('Select…') }, ...activeTypes.map((t) => ({ value: t.name, label: `${t.name} (${t.annual_entitlement}d)` }))]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From *"><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
                <Field label="To *"><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
              </div>
              {form.start_date && form.end_date && (
                <div className="rounded-lg border border-white/10 bg-navy/50 px-3 py-2 text-sm">
                  <div className="flex justify-between"><span className="text-ice-faint">{at('Working days')}</span><span className="font-mono text-ice">{wd}</span></div>
                  <div className="flex justify-between"><span className="text-ice-faint">{at('Advance notice')}</span><span className={`font-mono ${noticeOk ? 'text-ok' : 'text-bad'}`}>{notice} day(s)</span></div>
                </div>
              )}
              {lt && !noticeOk && (
                <div className="flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                  <Clock size={14} /> {lt.name} requires {lt.requires_notice_days} days advance notice.
                </div>
              )}
              {clash && (
                <div className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                  <AlertTriangle size={14} /> Overlaps an existing {clash.status} request ({date(clash.start_date)}–{date(clash.end_date)}).
                </div>
              )}
              <Field label="Reason"><textarea className="input min-h-[80px]" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(false)} className="btn-ghost">{at('Cancel')}</button>
              <button onClick={submitApply} disabled={saving || !noticeOk} className="btn-primary">{saving ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Decide modal */}
      {decideRow && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDecideRow(null)} />
          <div className="panel relative w-full max-w-md p-5 animate-rise">
            <h3 className="font-display text-lg font-bold text-ice">{at('Review request')}</h3>
            <p className="mt-1 text-sm text-ice-faint">{decideRow.employee_name} · {decideRow.leave_type} · {date(decideRow.start_date)}–{date(decideRow.end_date)} ({decideRow.working_days ?? decideRow.days}d)</p>
            {decideRow.reason && <p className="mt-2 rounded bg-white/[0.03] px-3 py-2 text-sm text-ice/80">{decideRow.reason}</p>}
            <Field label="Decision note (optional)"><textarea className="input mt-2 min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDecideRow(null)} className="btn-ghost">{at('Cancel')}</button>
              <button onClick={() => decide('declined')} className="btn bg-bad/15 text-bad hover:bg-bad/25"><X size={15} /> {at('Decline')}</button>
              <button onClick={() => decide('approved')} className="btn-primary"><Check size={15} /> {at('Approve')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Balances tab ─────────────────────────────────────────────────────────────
function Balances() {
  const { activeOrgId } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [leaveType, setLeaveType] = useState('Annual')   // default view

  useEffect(() => {
    if (!activeOrgId) return
    setLoading(true)
    supabase.from('leave_balances').select('*').eq('org_id', activeOrgId)
      .order('full_name').then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [activeOrgId])

  // All leave types present in the balance data, for the toggle
  const types = useMemo(() => [...new Set(rows.map((r) => r.leave_type))].sort(), [rows])

  // Fall back to the first available type if 'Annual' isn't configured
  const activeType = types.includes(leaveType) ? leaveType : (types[0] || 'Annual')

  // One row per employee, filtered to the selected leave type
  const view = rows
    .filter((r) => r.leave_type === activeType)
    .map((r) => ({ ...r, id: r.employee_id }))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">{at('Leave type:')}</span>
        {types.map((t) => (
          <button key={t} onClick={() => setLeaveType(t)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              activeType === t ? 'border-accent-line bg-accent-soft text-accent' : 'border-white/10 text-ice-dim hover:bg-white/[0.04] hover:text-ice'
            }`}>
            {t}
          </button>
        ))}
      </div>

      <DataTable
        loading={loading} rows={view}
        searchKeys={['full_name']}
        emptyTitle="No balances yet" emptyHint="Add employees and leave types to see balances."
        columns={[
          { key: 'full_name', label: at('Employee') },
          { key: 'annual_entitlement', label: `${activeType} entitlement`, render: (v) => <span className="font-mono">{num(v)}</span> },
          { key: 'adjustments', label: at('Adjustments'), render: (v) => <span className="font-mono">{Number(v) > 0 ? '+' : ''}{num(v)}</span> },
          { key: 'used_days', label: at('Used'), render: (v) => <span className="font-mono text-warn">{num(v)}</span> },
          { key: 'remaining_days', label: at('Remaining'), render: (v) => <span className={`font-mono font-semibold ${Number(v) <= 0 ? 'text-bad' : 'text-ok'}`}>{num(v)}</span> },
        ]}
      />
    </>
  )
}

// ── Calendar tab ─────────────────────────────────────────────────────────────
function LeaveCalendar() {
  const { activeOrgId } = useAuth()
  const { rows: requests } = useTable('leave_requests')
  const { rows: types } = useTable('leave_types')
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [showType, setShowType] = useState('')   // '' = all types

  const colorFor = (name) => types.find((t) => t.name === name)?.color || '#F59E0B'

  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const firstDay = new Date(cursor.y, cursor.m, 1).getDay()   // 0 Sun
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // Approved leave that overlaps this month, optionally filtered by type
  const inMonth = useMemo(() => requests.filter((r) => {
    if (r.status !== 'approved') return false
    if (showType && r.leave_type !== showType) return false
    const s = new Date(r.start_date), e = new Date(r.end_date)
    const mStart = new Date(cursor.y, cursor.m, 1), mEnd = new Date(cursor.y, cursor.m, daysInMonth)
    return !(e < mStart || s > mEnd)
  }), [requests, showType, cursor, daysInMonth])

  // Map day-of-month -> array of {name, type, color}
  const byDay = useMemo(() => {
    const map = {}
    inMonth.forEach((r) => {
      const s = new Date(r.start_date), e = new Date(r.end_date)
      for (let d = 1; d <= daysInMonth; d++) {
        const cell = new Date(cursor.y, cursor.m, d)
        if (cell >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) && cell <= new Date(e.getFullYear(), e.getMonth(), e.getDate())) {
          (map[d] ||= []).push({ name: r.employee_name, type: r.leave_type, color: colorFor(r.leave_type) })
        }
      }
    })
    return map
  }, [inMonth, cursor, daysInMonth, types])

  const move = (delta) => setCursor((c) => {
    const nm = c.m + delta
    return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 }
  })
  const goToday = () => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }

  const activeTypes = types.filter((t) => t.active !== false)
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => move(-1)} className="btn-ghost btn-sm"><ChevronLeft size={15} /></button>
          <span className="min-w-[150px] text-center font-display text-lg font-bold text-ice">{monthName}</span>
          <button onClick={() => move(1)} className="btn-ghost btn-sm"><ChevronRight size={15} /></button>
          <button onClick={goToday} className="btn-ghost btn-sm ml-1">{at('Today')}</button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={() => setShowType('')}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${showType === '' ? 'border-accent-line bg-accent-soft text-accent' : 'border-white/10 text-ice-dim hover:text-ice'}`}>
            All
          </button>
          {activeTypes.map((t) => (
            <button key={t.id} onClick={() => setShowType(t.name)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${showType === t.name ? 'border-white/30 text-ice' : 'border-white/10 text-ice-dim hover:text-ice'}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="panel overflow-hidden p-3">
        <div className="grid grid-cols-7 gap-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="pb-2 text-center font-mono text-[10px] uppercase tracking-wider text-ice-faint">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} className="min-h-[92px] rounded-lg" />
            const cellDate = new Date(cursor.y, cursor.m, d)
            const isToday = cellDate.getTime() === today.getTime()
            const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6
            const people = byDay[d] || []
            return (
              <div key={d} className={`min-h-[92px] rounded-lg border p-1.5 transition ${isToday ? 'border-accent/60 bg-accent-soft' : isWeekend ? 'border-white/[0.04] bg-white/[0.01]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                <div className={`mb-1 text-right font-mono text-xs ${isToday ? 'font-bold text-accent' : 'text-ice-faint'}`}>{d}</div>
                <div className="space-y-0.5">
                  {people.slice(0, 3).map((p, idx) => (
                    <div key={idx} className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] text-ice/90"
                      style={{ background: `${p.color}22`, borderLeft: `2px solid ${p.color}` }} title={`${p.name} — ${p.type}`}>
                      <span className="truncate">{p.name}</span>
                    </div>
                  ))}
                  {people.length > 3 && <div className="px-1 text-[10px] text-ice-faint">+{people.length - 3} more</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-ice-faint">
        <CalendarDays size={13} /> Showing approved leave only. Colours match each leave type.
      </p>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function HR() {
  const [tab, setTab] = useState('requests')
  return (
    <div>
      <PageHeader eyebrow="People" title="Leave Management" />
      <TabStrip tab={tab} setTab={setTab} />

      {tab === 'requests' && <Requests />}
      {tab === 'balances' && <Balances />}
      {tab === 'calendar' && <LeaveCalendar />}
      {tab === 'types' && (
        <ModuleScaffold
          eyebrow="People" title="Leave Types" table="leave_types"
          newLabel="New leave type" emptyTitle="No leave types"
          emptyHint="Define leave categories, annual entitlements, and notice rules."
          searchKeys={['name', at('code')]}
          columns={[
            { key: 'name', label: at('Type') },
            { key: 'code', label: at('Code'), render: (v) => v ? <span className="font-mono text-accent">{v}</span> : '—' },
            { key: 'annual_entitlement', label: at('Entitlement (days)'), render: (v) => <span className="font-mono">{v}</span> },
            { key: 'requires_notice_days', label: at('Notice (days)'), render: (v) => <span className="font-mono">{v}</span> },
            { key: 'paid', label: at('Paid'), render: (v) => <Badge tone={v ? 'ok' : 'mute'}>{v ? 'paid' : 'unpaid'}</Badge> },
          ]}
          fields={[
            { key: 'name', label: at('Name'), required: true },
            { key: 'code', label: at('Code') },
            { key: 'annual_entitlement', label: at('Annual entitlement (days)'), type: 'number', default: 0 },
            { key: 'requires_notice_days', label: at('Advance notice (days)'), type: 'number', default: 1 },
            { key: 'color', label: at('Colour (hex)'), default: '#F59E0B' },
          ]}
          beforeSave={(p) => ({ ...p, paid: p.paid ?? true, active: true })}
          kpis={(rows) => <>
            <StatCard label="Leave types" value={rows.length} icon={Layers} />
            <StatCard label="Total annual days" value={rows.reduce((s, r) => s + Number(r.annual_entitlement || 0), 0)} icon={CalendarCheck} />
            <StatCard label="Paid types" value={rows.filter((r) => r.paid).length} icon={Wallet} />
            <StatCard label="No-notice types" value={rows.filter((r) => (r.requires_notice_days || 0) === 0).length} icon={Clock} />
          </>}
        />
      )}
    </div>
  )
}
