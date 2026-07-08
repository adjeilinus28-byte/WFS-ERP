import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, Field, Select, useToast, EmptyState } from '../components/ui'
import { date } from '../lib/format'
import {
  GraduationCap, CalendarClock, Users, Megaphone, Award, AlertTriangle, Check, X, Plus,
  ClipboardCheck, ShieldCheck, TrendingUp, Clock, Paperclip,
} from 'lucide-react'

const CARD = { background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }
const PALETTE = ['rgb(var(--accent))', '#38BDF8', '#34D399', '#F472B6', '#A78BFA', '#FBBF24', '#F87171']
const TYPES = [
  ['induction', 'Induction'], ['toolbox_talk', 'Toolbox Talk'], ['refresher', 'Refresher'],
  ['competency', 'Competency'], ['first_aid', 'First Aid'], ['fire_safety', 'Fire Safety'],
  ['working_at_heights', 'Working at Heights'], ['confined_space', 'Confined Space'], ['other', 'Other'],
]
const typeLabel = (t) => (TYPES.find((x) => x[0] === t) || [t, t])[1]
const STATUS = ['scheduled', 'in_progress', 'completed', 'cancelled']
const ATT_STATUS = ['assigned', 'attended', 'completed', 'absent', 'failed']
const CERT_TONE = { valid: 'ok', expiring: 'warn', expired: 'bad', scheduled: 'accent', assigned: 'accent', attended: 'accent', absent: 'mute', failed: 'bad' }
const iso = (d) => d.toISOString().slice(0, 10)

// Uploads to the public 'training-files' bucket → returns a public URL (email-fetchable)
function TrainingAttachment({ value, name, onChange }) {
  const { activeOrgId } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const handle = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setErr('Max 10 MB'); return }
    setBusy(true); setErr('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${activeOrgId}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('training-files').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('training-files').getPublicUrl(path)
      onChange(data.publicUrl, file.name)
    } catch (e2) { setErr(e2.message || 'Upload failed') } finally { setBusy(false) }
  }
  return (
    <div>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-2">
          <Paperclip size={14} className="text-accent" />
          <a href={value} target="_blank" rel="noreferrer" className="flex-1 truncate text-xs text-info hover:underline">{name || 'View attachment'}</a>
          <button type="button" onClick={() => onChange(null, null)} className="text-ice-faint hover:text-bad"><X size={14} /></button>
        </div>
      ) : (
        <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-navy/40 px-3 py-2.5 text-xs text-ice-dim transition hover:border-accent/50 hover:text-ice">
          {busy ? 'Uploading…' : 'Upload attachment'}
          <input type="file" accept=".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp" onChange={handle} className="hidden" disabled={busy} />
        </label>
      )}
      {err && <p className="mt-1 text-[11px] text-bad">{err}</p>}
    </div>
  )
}

function Tabs({ tab, setTab, canManage }) {
  const items = [['dashboard', 'Dashboard'], ['schedule', 'Schedule'], ['attendance', 'Attendance'], ['matrix', 'Compliance Matrix']]
  return (
    <div className="mb-5 inline-flex flex-wrap rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>{l}</button>
      ))}
    </div>
  )
}

// ── Schedule: create sessions, assign audience, announce ─────────────────────
function Schedule() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows: employees } = useTable('employees')
  const { rows: sessions, loading, refresh } = useTable('training_sessions', { order: { column: 'scheduled_at', ascending: false } })
  const [drawer, setDrawer] = useState(null)
  const canManage = ['owner', 'admin', 'manager', 'supervisor'].includes(role)

  const blank = { title: '', description: '', training_type: 'toolbox_talk', trainer: '', mode: 'in_person', venue: '', link_url: '', scheduled_at: '', duration_mins: '', audience: 'department', department: '', validity_months: '', status: 'scheduled' }

  const save = async () => {
    const f = drawer
    if (!f.title) { toast.error('Title required'); return }
    const payload = {
      org_id: activeOrgId, title: f.title, description: f.description, training_type: f.training_type,
      trainer: f.trainer, mode: f.mode, venue: f.venue, link_url: f.link_url,
      scheduled_at: f.scheduled_at || null, duration_mins: f.duration_mins ? Number(f.duration_mins) : null,
      audience: f.audience, department: f.audience === 'department' ? f.department : null,
      validity_months: f.validity_months ? Number(f.validity_months) : null, status: f.status,
      attachment_url: f.attachment_url || null, attachment_name: f.attachment_name || null,
      updated_at: new Date().toISOString(),
    }
    try {
      let sessionId = f.id
      if (f.id) { await supabase.from('training_sessions').update(payload).eq('id', f.id) }
      else { const { data, error } = await supabase.from('training_sessions').insert(payload).select().single(); if (error) throw error; sessionId = data.id }

      // Populate attendees: all/department auto-fill; individuals = the picked list
      if (f.audience === 'individuals') {
        const picked = f.selected || []
        if (picked.length) {
          const targets = employees.filter((e) => picked.includes(e.id))
          await supabase.from('training_attendees').upsert(
            targets.map((e) => ({ org_id: activeOrgId, session_id: sessionId, employee_id: e.id, employee_name: e.full_name, department: e.department, status: 'assigned' })),
            { onConflict: 'session_id,employee_id', ignoreDuplicates: true })
        }
      } else {
        const targets = employees.filter((e) => f.audience === 'all' || e.department === f.department)
        if (targets.length) {
          await supabase.from('training_attendees').upsert(
            targets.map((e) => ({ org_id: activeOrgId, session_id: sessionId, employee_id: e.id, employee_name: e.full_name, department: e.department, status: 'assigned' })),
            { onConflict: 'session_id,employee_id', ignoreDuplicates: true })
        }
      }
      toast.success(f.id ? 'Updated' : 'Session created'); setDrawer(null); refresh()
    } catch (e) { toast.error(e.message) }
  }

  const announce = async (s) => {
    if (!window.confirm(`Announce "${s.title}"? This emails assigned staff and posts a News Flash banner.`)) return
    try {
      const res = await fetch('/.netlify/functions/training-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: activeOrgId, session_id: s.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Announce failed')
      toast.success(`Announced — ${data.emailed} emailed, banner posted`); refresh()
    } catch (e) { toast.error(e.message + ' (deploy the Netlify function first)') }
  }

  const del = async (s) => { if (!window.confirm(`Delete "${s.title}"?`)) return; await supabase.from('training_sessions').delete().eq('id', s.id); refresh() }

  return (
    <div>
      {canManage && <button onClick={() => setDrawer(blank)} className="btn-primary mb-4"><Plus size={15} /> Schedule training</button>}
      {loading ? <div className="panel p-8 text-center text-ice-faint">Loading…</div>
      : sessions.length === 0 ? <EmptyState title="No training scheduled" hint="Create a session and assign a department, individuals, or all staff." />
      : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="panel flex flex-wrap items-center gap-3 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><GraduationCap size={18} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold text-ice">{s.title}</span>
                  <Badge>{typeLabel(s.training_type)}</Badge>
                  <Badge tone={s.status === 'completed' ? 'ok' : s.status === 'cancelled' ? 'mute' : 'accent'}>{s.status}</Badge>
                  {s.announced_at && <Badge tone="ok"><Megaphone size={10} className="mr-1 inline" />announced</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-ice-faint">
                  {s.scheduled_at ? new Date(s.scheduled_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unscheduled'}
                  {' · '}{s.audience === 'all' ? 'All staff' : s.audience === 'department' ? s.department : 'Selected staff'}
                  {s.venue ? ` · ${s.venue}` : ''}{s.validity_months ? ` · valid ${s.validity_months}mo` : ''}
                </div>
                {s.attachment_url && <a href={s.attachment_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-info hover:underline"><Paperclip size={11} /> {s.attachment_name || 'Attachment'}</a>}
              </div>
              {canManage && (
                <div className="flex gap-1.5">
                  <button onClick={() => announce(s)} className="btn-ghost btn-sm" title="Announce (email + banner)"><Megaphone size={14} /></button>
                  <button onClick={async () => {
                    let selected = []
                    if (s.audience === 'individuals') {
                      const { data } = await supabase.from('training_attendees').select('employee_id').eq('session_id', s.id)
                      selected = (data || []).map((a) => a.employee_id).filter(Boolean)
                    }
                    setDrawer({ ...s, scheduled_at: s.scheduled_at ? s.scheduled_at.slice(0, 16) : '', selected })
                  }} className="btn-ghost btn-sm">Edit</button>
                  <button onClick={() => del(s)} className="text-ice-faint hover:text-bad"><X size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={() => setDrawer(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-navy-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-ice">{drawer.id ? 'Edit session' : 'Schedule training'}</h3>
              <button onClick={() => setDrawer(null)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <Field label="Title *"><input className="input" value={drawer.title} onChange={(e) => setDrawer({ ...drawer, title: e.target.value })} /></Field>
              <Field label="Description"><textarea className="input min-h-[70px]" value={drawer.description || ''} onChange={(e) => setDrawer({ ...drawer, description: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><Select value={drawer.training_type} onChange={(e) => setDrawer({ ...drawer, training_type: e.target.value })} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} /></Field>
                <Field label="Trainer"><input className="input" value={drawer.trainer || ''} onChange={(e) => setDrawer({ ...drawer, trainer: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date & time"><input className="input" type="datetime-local" value={drawer.scheduled_at || ''} onChange={(e) => setDrawer({ ...drawer, scheduled_at: e.target.value })} /></Field>
                <Field label="Duration (mins)"><input className="input" type="number" value={drawer.duration_mins || ''} onChange={(e) => setDrawer({ ...drawer, duration_mins: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mode"><Select value={drawer.mode} onChange={(e) => setDrawer({ ...drawer, mode: e.target.value })} options={[{ value: 'in_person', label: 'In person' }, { value: 'online', label: 'Online' }]} /></Field>
                {drawer.mode === 'online'
                  ? <Field label="Join link"><input className="input" value={drawer.link_url || ''} onChange={(e) => setDrawer({ ...drawer, link_url: e.target.value })} /></Field>
                  : <Field label="Venue"><input className="input" value={drawer.venue || ''} onChange={(e) => setDrawer({ ...drawer, venue: e.target.value })} /></Field>}
              </div>
              <Field label="Audience"><Select value={drawer.audience} onChange={(e) => setDrawer({ ...drawer, audience: e.target.value })} options={[{ value: 'all', label: 'All staff' }, { value: 'department', label: 'A department' }, { value: 'individuals', label: 'Selected individuals' }]} /></Field>
              {drawer.audience === 'department' && <Field label="Department"><Select value={drawer.department || ''} onChange={(e) => setDrawer({ ...drawer, department: e.target.value })} options={[{ value: '', label: 'Select…' }, ...deptOptions]} /></Field>}
              {drawer.audience === 'individuals' && (
                <Field label={`Select workers (${(drawer.selected || []).length} chosen)`}>
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-navy/40 p-2">
                    {employees.length === 0 ? <p className="p-2 text-xs text-ice-faint">No employees found.</p>
                    : employees.map((e) => {
                      const on = (drawer.selected || []).includes(e.id)
                      return (
                        <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5">
                          <input type="checkbox" checked={on} className="h-4 w-4 accent-[rgb(var(--accent))]"
                            onChange={() => setDrawer((d) => { const set = new Set(d.selected || []); on ? set.delete(e.id) : set.add(e.id); return { ...d, selected: [...set] } })} />
                          <span className="text-ice">{e.full_name}</span>
                          {e.department && <span className="ml-auto text-[11px] text-ice-faint">{e.department}</span>}
                        </label>
                      )
                    })}
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Validity (months, optional)"><input className="input" type="number" value={drawer.validity_months || ''} onChange={(e) => setDrawer({ ...drawer, validity_months: e.target.value })} placeholder="e.g. 12" /></Field>
                <Field label="Status"><Select value={drawer.status} onChange={(e) => setDrawer({ ...drawer, status: e.target.value })} options={STATUS.map((s) => ({ value: s, label: s }))} /></Field>
              </div>
              <Field label="Attachment (Excel, PDF, or photo — sent with the email)">
                <TrainingAttachment value={drawer.attachment_url} name={drawer.attachment_name}
                  onChange={(url, name) => setDrawer((d) => ({ ...d, attachment_url: url, attachment_name: name }))} />
              </Field>
            </div>
            <button onClick={save} className="btn-primary mt-5 w-full">{drawer.id ? 'Save changes' : 'Create session'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Attendance: manage attendees, mark completion/scores ─────────────────────
function Attendance() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { rows: sessions } = useTable('training_sessions', { order: { column: 'scheduled_at', ascending: false } })
  const { rows: employees } = useTable('employees')
  const [sessionId, setSessionId] = useState('')
  const [atts, setAtts] = useState([])
  const [addId, setAddId] = useState('')
  const canManage = ['owner', 'admin', 'manager', 'supervisor'].includes(role)

  const load = () => { if (sessionId) supabase.from('training_attendees').select('*').eq('session_id', sessionId).order('employee_name').then(({ data }) => setAtts(data || [])) }
  useEffect(load, [sessionId])

  const session = sessions.find((s) => s.id === sessionId)
  const patch = async (a, p) => { try { await supabase.from('training_attendees').update(p).eq('id', a.id); load() } catch (e) { toast.error(e.message) } }
  const addPerson = async () => {
    if (!addId) return
    const e = employees.find((x) => x.id === addId)
    try {
      await supabase.from('training_attendees').insert({ org_id: activeOrgId, session_id: sessionId, employee_id: e.id, employee_name: e.full_name, department: e.department, status: 'assigned' })
      setAddId(''); load()
    } catch (err) { toast.error(err.message.includes('duplicate') ? 'Already assigned' : err.message) }
  }
  const remove = async (a) => { await supabase.from('training_attendees').delete().eq('id', a.id); load() }
  const markComplete = (a) => patch(a, { status: 'completed', completed_at: iso(new Date()) })

  const unassigned = employees.filter((e) => !atts.some((a) => a.employee_id === e.id))
  const completed = atts.filter((a) => a.status === 'completed').length

  return (
    <div>
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Session:</span>
        <div className="min-w-[280px] flex-1"><Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} options={[{ value: '', label: 'Select a session…' }, ...sessions.map((s) => ({ value: s.id, label: `${s.title} — ${s.scheduled_at ? date(s.scheduled_at) : 'unscheduled'}` }))]} /></div>
        {session && <Badge tone="accent">{atts.length} assigned · {completed} completed</Badge>}
      </div>

      {!sessionId ? <EmptyState title="Select a session" hint="Pick a training session to manage its attendance." />
      : (
        <>
          {canManage && (
            <div className="panel mb-3 flex flex-wrap items-center gap-2 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Add attendee:</span>
              <div className="min-w-[220px]"><Select value={addId} onChange={(e) => setAddId(e.target.value)} options={[{ value: '', label: 'Select employee…' }, ...unassigned.map((e) => ({ value: e.id, label: e.full_name }))]} /></div>
              <button onClick={addPerson} disabled={!addId} className="btn-primary btn-sm"><Plus size={13} /> Add</button>
            </div>
          )}
          <div className="panel overflow-hidden">
            {atts.length === 0 ? <EmptyState title="No attendees yet" hint="Add people above, or set the audience to a department/all when scheduling." />
            : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/[0.02]"><tr>
                    <th className="th">Employee</th><th className="th">Dept</th><th className="th">Status</th><th className="th">Score</th><th className="th">Completed</th><th className="th">Expires</th>{canManage && <th className="th"></th>}
                  </tr></thead>
                  <tbody>
                    {atts.map((a) => (
                      <tr key={a.id} className="transition hover:bg-white/[0.025]">
                        <td className="td font-medium">{a.employee_name}</td>
                        <td className="td text-sm text-ice-faint">{a.department || '—'}</td>
                        <td className="td">
                          {canManage ? <Select value={a.status} onChange={(e) => patch(a, e.target.value === 'completed' ? { status: 'completed', completed_at: a.completed_at || iso(new Date()) } : { status: e.target.value })} options={ATT_STATUS.map((s) => ({ value: s, label: s }))} />
                          : <Badge tone={CERT_TONE[a.status] || 'mute'}>{a.status}</Badge>}
                        </td>
                        <td className="td">{canManage ? <input className="input w-16" type="number" value={a.score ?? ''} onChange={(e) => patch(a, { score: e.target.value ? Number(e.target.value) : null })} /> : (a.score ?? '—')}</td>
                        <td className="td text-sm">{a.completed_at ? date(a.completed_at) : '—'}</td>
                        <td className="td text-sm">{a.expires_at ? <Badge tone={new Date(a.expires_at) < new Date() ? 'bad' : 'ok'}>{date(a.expires_at)}</Badge> : '—'}</td>
                        {canManage && <td className="td"><div className="flex gap-1">{a.status !== 'completed' && <button onClick={() => markComplete(a)} className="btn-ghost btn-sm" title="Mark completed"><Check size={13} /></button>}<button onClick={() => remove(a)} className="text-ice-faint hover:text-bad"><X size={14} /></button></div></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Compliance matrix: employees × training type ────────────────────────────
function Matrix() {
  const { activeOrgId } = useAuth()
  const { options: deptOptions } = useDepartments()
  const [rows, setRows] = useState([])
  const [dept, setDept] = useState('')

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('training_matrix').select('*').eq('org_id', activeOrgId).then(({ data }) => setRows(data || []))
  }, [activeOrgId])

  const filtered = dept ? rows.filter((r) => r.department === dept) : rows
  const employees = [...new Map(filtered.map((r) => [r.employee_id, { id: r.employee_id, name: r.employee_name, dept: r.department }])).values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  const typesPresent = TYPES.filter(([t]) => filtered.some((r) => r.training_type === t))
  const cell = (empId, type) => filtered.find((r) => r.employee_id === empId && r.training_type === type)

  return (
    <div>
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Department:</span>
        <div className="w-52"><Select value={dept} onChange={(e) => setDept(e.target.value)} options={[{ value: '', label: 'All departments' }, ...deptOptions]} /></div>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-ok" /> Valid</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warn" /> Expiring</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-bad" /> Expired</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-accent" /> Scheduled</span>
        </div>
      </div>

      {employees.length === 0 ? <EmptyState title="No training records yet" hint="Once staff are assigned and complete training, their competency status appears here." />
      : (
        <div className="panel overflow-x-auto p-3">
          <table className="w-full border-collapse">
            <thead><tr>
              <th className="px-2 py-2 text-left font-mono text-[10px] uppercase text-ice-faint">Employee</th>
              {typesPresent.map(([t, l]) => <th key={t} className="px-2 py-2 text-center font-mono text-[9px] uppercase text-ice-faint" style={{ writingMode: 'vertical-rl' }}>{l}</th>)}
            </tr></thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-t border-white/[0.04]">
                  <td className="px-2 py-1.5 text-xs text-ice whitespace-nowrap">{emp.name}<div className="text-[10px] text-ice-faint">{emp.dept}</div></td>
                  {typesPresent.map(([t]) => {
                    const c = cell(emp.id, t)
                    const tone = c ? CERT_TONE[c.cert_status] : null
                    const bg = { ok: '#16a34a', warn: '#F59E0B', bad: '#dc2626', accent: 'rgb(var(--accent))', mute: '#475569' }[tone] || '#1e293b'
                    return (
                      <td key={t} className="px-2 py-1.5 text-center">
                        {c ? <span title={`${c.cert_status}${c.expires_at ? ' · expires ' + c.expires_at : ''}`} className="mx-auto grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: bg }}>{c.cert_status === 'valid' ? '✓' : c.cert_status === 'expired' ? '✕' : c.cert_status === 'expiring' ? '!' : '•'}</span>
                        : <span className="text-ice-faint/30">·</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const { activeOrgId } = useAuth()
  const { rows: sessions } = useTable('training_sessions')
  const [matrix, setMatrix] = useState([])
  const [atts, setAtts] = useState([])

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('training_matrix').select('*').eq('org_id', activeOrgId).then(({ data }) => setMatrix(data || []))
    supabase.from('training_attendees').select('status, session_id').eq('org_id', activeOrgId).then(({ data }) => setAtts(data || []))
  }, [activeOrgId])

  const now = new Date()
  const upcoming = sessions.filter((s) => s.scheduled_at && new Date(s.scheduled_at) >= now && s.status === 'scheduled')
  const completedCount = atts.filter((a) => a.status === 'completed').length
  const completionRate = atts.length ? Math.round((completedCount / atts.length) * 100) : 0
  const expired = matrix.filter((r) => r.cert_status === 'expired').length
  const expiring = matrix.filter((r) => r.cert_status === 'expiring').length

  const byType = useMemo(() => {
    const m = {}
    sessions.forEach((s) => { const k = typeLabel(s.training_type); m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).map(([name, value]) => ({ name, value }))
  }, [sessions])
  const certMix = useMemo(() => {
    const m = { valid: 0, expiring: 0, expired: 0, scheduled: 0 }
    matrix.forEach((r) => { if (m[r.cert_status] != null) m[r.cert_status]++ })
    return Object.entries(m).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }))
  }, [matrix])

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Upcoming sessions" value={upcoming.length} icon={CalendarClock} />
        <StatCard label="Completion rate" value={`${completionRate}%`} tone={completionRate >= 80 ? 'ok' : 'warn'} icon={ClipboardCheck} />
        <StatCard label="Expiring (30d)" value={expiring} tone={expiring ? 'warn' : 'ok'} icon={Clock} />
        <StatCard label="Expired certs" value={expired} tone={expired ? 'bad' : 'ok'} icon={AlertTriangle} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="eyebrow mb-4">Sessions by type</div>
          {byType.length === 0 ? <div className="grid h-56 place-items-center text-sm text-ice-faint">No sessions yet</div>
          : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byType} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={CARD} />
                <Bar dataKey="value" radius={[5, 5, 0, 0]}>{byType.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="panel p-5">
          <div className="eyebrow mb-4">Certification status</div>
          {certMix.length === 0 ? <div className="grid h-56 place-items-center text-sm text-ice-faint">No completions yet</div>
          : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={certMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {certMix.map((e, i) => <Cell key={i} fill={{ valid: '#16a34a', expiring: '#F59E0B', expired: '#dc2626', scheduled: 'rgb(var(--accent))' }[e.name] || PALETTE[i]} />)}
                </Pie>
                <Tooltip contentStyle={CARD} /><Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="panel mt-4 overflow-hidden">
          <div className="border-b border-white/[0.06] px-5 py-3"><span className="eyebrow">Next up</span></div>
          {upcoming.slice(0, 6).map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-white/[0.04] px-5 py-3">
              <GraduationCap size={16} className="text-accent" />
              <div className="min-w-0 flex-1"><div className="text-sm text-ice">{s.title}</div><div className="text-xs text-ice-faint">{typeLabel(s.training_type)} · {s.audience === 'department' ? s.department : s.audience === 'all' ? 'All staff' : 'Selected staff'}</div></div>
              <span className="font-mono text-[11px] text-ice-faint">{new Date(s.scheduled_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Training() {
  const { role } = useAuth()
  const canManage = ['owner', 'admin', 'manager', 'supervisor'].includes(role)
  const [tab, setTab] = useState('dashboard')
  return (
    <div>
      <PageHeader eyebrow="Compliance" title="Training & Competency" />
      <Tabs tab={tab} setTab={setTab} canManage={canManage} />
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'schedule' && <Schedule />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'matrix' && <Matrix />}
    </div>
  )
}
