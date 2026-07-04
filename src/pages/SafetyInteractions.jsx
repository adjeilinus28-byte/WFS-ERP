import { useEffect, useMemo, useState } from 'react'
import { Plus, X, Search, ShieldCheck, ClipboardCheck, Eye, Target, Camera, Check, AlertTriangle, TrendingUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { StatCard, Badge, statusTone, Field, Select, useToast, EmptyState, PageHeader } from '../components/ui'
import PhotoUpload from '../components/PhotoUpload'
import ModuleScaffold from '../components/ModuleScaffold'
import { date } from '../lib/format'

const FORM_META = {
  ccv:   { label: 'CCV',    full: 'Critical Control Verification', icon: ShieldCheck },
  pto:   { label: 'PTO',    full: 'Planned Task Observation',      icon: Eye },
  take5: { label: 'Take 5', full: 'Take 5 (Stop·Look·Assess·Manage)', icon: ClipboardCheck },
}

function notify(org_id, interaction_id) {
  fetch('/.netlify/functions/ccv-action-notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ org_id, interaction_id }),
  }).catch(() => {})
}

// ── KPI dashboard ────────────────────────────────────────────────────────────
function KpiDashboard({ targets }) {
  const { activeOrgId } = useAuth()
  const [kpi, setKpi] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('safety_kpi').select('*').eq('org_id', activeOrgId)
      .then(({ data }) => { setKpi(data || []); setLoading(false) })
  }, [activeOrgId])

  const targetFor = (role, ft) => targets.find((t) => t.role === role && t.form_type === ft)?.monthly_target || 0

  // group by observer
  const observers = useMemo(() => {
    const m = {}
    kpi.forEach((k) => { (m[k.observer_name] ||= { name: k.observer_name, role: k.observer_role, rows: {} }).rows[k.form_type] = k.done_this_month })
    return Object.values(m)
  }, [kpi])

  const totalDone = kpi.reduce((s, k) => s + Number(k.done_this_month || 0), 0)
  const period = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  if (loading) return <div className="panel p-8 text-center text-ice-faint">Loading KPIs…</div>

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Completed this month" value={totalDone} icon={TrendingUp} sub={period} />
        <StatCard label="Active observers" value={observers.length} icon={Eye} />
        <StatCard label="CCV targets" value={targets.filter((t) => t.form_type === 'ccv').length} icon={ShieldCheck} />
        <StatCard label="Roles configured" value={[...new Set(targets.map((t) => t.role))].length} icon={Target} />
      </div>

      {observers.length === 0 ? <EmptyState title="No interactions logged this month" hint="Once the workforce logs CCVs, PTOs, and Take 5s, progress against target appears here." />
      : (
        <div className="panel overflow-hidden">
          <table className="w-full">
            <thead className="bg-white/[0.02]"><tr>
              <th className="th">Observer</th><th className="th">Role</th>
              {['ccv', 'pto', 'take5'].map((ft) => <th key={ft} className="th">{FORM_META[ft].label}</th>)}
            </tr></thead>
            <tbody>
              {observers.map((o, i) => (
                <tr key={i} className="transition hover:bg-white/[0.025]">
                  <td className="td">{o.name}</td>
                  <td className="td">{o.role ? <Badge>{o.role}</Badge> : '—'}</td>
                  {['ccv', 'pto', 'take5'].map((ft) => {
                    const done = o.rows[ft] || 0
                    const tgt = targetFor(o.role, ft)
                    const pct = tgt ? Math.min(100, (done / tgt) * 100) : (done ? 100 : 0)
                    const met = tgt && done >= tgt
                    return (
                      <td key={ft} className="td">
                        <div className="min-w-[110px]">
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="font-mono text-ice-dim">{done}{tgt ? `/${tgt}` : ''}</span>
                            {met && <Check size={13} className="text-ok" />}
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div className={`h-full rounded-full ${met ? 'bg-ok' : pct >= 50 ? 'bg-accent' : 'bg-warn'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
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

// ── Interaction log + entry ──────────────────────────────────────────────────
function InteractionLog() {
  const { activeOrgId, role, user } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove, refresh } = useTable('safety_interactions')
  const { rows: employees } = useTable('employees')
  const [type, setType] = useState('ccv')
  const [drawer, setDrawer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fType, setFType] = useState('')
  const [q, setQ] = useState('')
  const canWrite = role && role !== 'viewer'

  const filtered = rows.filter((r) => (!fType || r.form_type === fType) &&
    (!q.trim() || [r.ref_no, r.observer_name, r.title, r.location].some((v) => String(v ?? '').toLowerCase().includes(q.toLowerCase()))))

  const blank = {
    form_type: 'ccv', observer_id: '', observer_name: user?.email, observer_role: role, department: '', location: '',
    observed_on: new Date().toISOString().slice(0, 10), title: '', details: '',
    critical_control: '', control_effective: true,
    t5_stop: false, t5_look: false, t5_assess: false, t5_manage: false,
    task_observed: '', safe_behaviours: '', at_risk_behaviours: '',
    action_required: false, action_description: '', assigned_to_id: '', assigned_to_name: '', assigned_to_email: '', action_due: '',
    photo_urls: [],
  }
  const [form, setForm] = useState(blank)
  const open = (t) => { setForm({ ...blank, form_type: t, observer_name: user?.email, observer_role: role }); setDrawer(true) }

  const pickObserver = (id) => { const e = employees.find((x) => x.id === id); setForm((f) => ({ ...f, observer_id: id, observer_name: e?.full_name || f.observer_name, department: e?.department || f.department })) }
  const pickAssignee = (id) => { const e = employees.find((x) => x.id === id); setForm((f) => ({ ...f, assigned_to_id: id, assigned_to_name: e?.full_name || '', assigned_to_email: e?.email || '' })) }

  const save = async () => {
    setSaving(true)
    try {
      const num = (v) => (v === '' || v == null ? 0 : Number(v))
      const payload = {
        ...form,
        ref_no: form.ref_no || `${form.form_type.toUpperCase()}-${Date.now().toString().slice(-6)}`,
        safe_behaviours: num(form.safe_behaviours), at_risk_behaviours: num(form.at_risk_behaviours),
        observer_id: form.observer_id || null, assigned_to_id: form.assigned_to_id || null,
        action_status: form.action_required ? 'open' : null,
        observed_on: form.observed_on || new Date().toISOString().slice(0, 10),
      }
      const [created] = await insert(payload)
      // CCV with an assigned action → email the responsible person
      if (created?.id && form.form_type === 'ccv' && form.action_required && form.assigned_to_email) {
        notify(activeOrgId, created.id)
        toast.success('CCV logged — action emailed to assignee')
      } else toast.success(`${FORM_META[form.form_type].label} logged`)
      setDrawer(false)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const closeAction = async (r) => {
    const note = window.prompt('Close-out note (optional):', '')
    if (note === null) return
    try { await update(r.id, { action_status: 'closed', action_closed_at: new Date().toISOString(), action_close_note: note }); toast.success('Action closed') } catch (e) { toast.error(e.message) }
  }
  const del = async (r) => { if (!window.confirm(`Delete ${r.ref_no}?`)) return; try { await remove(r.id); toast.success('Deleted') } catch (e) { toast.error(e.message) } }

  const openActions = rows.filter((r) => r.action_required && r.action_status === 'open').length

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-1.5">
          <Search size={15} className="text-ice-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-44 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
        </div>
        <div className="w-36"><Select value={fType} onChange={(e) => setFType(e.target.value)} options={[{ value: '', label: 'All types' }, ...Object.keys(FORM_META).map((k) => ({ value: k, label: FORM_META[k].label }))]} /></div>
        {openActions > 0 && <Badge tone="bad">{openActions} open action(s)</Badge>}
        {canWrite && (
          <div className="ml-auto flex gap-2">
            {Object.keys(FORM_META).map((k) => { const I = FORM_META[k].icon; return (
              <button key={k} onClick={() => open(k)} className="btn-primary btn-sm"><I size={14} /> {FORM_META[k].label}</button>
            )})}
          </div>
        )}
      </div>

      <div className="panel overflow-hidden">
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : filtered.length === 0 ? <EmptyState title="No safety interactions yet" hint="Log a CCV, PTO, or Take 5 using the buttons above." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.02]"><tr>
                <th className="th">Ref</th><th className="th">Type</th><th className="th">Observer</th>
                <th className="th">Location</th><th className="th">Date</th><th className="th">Action</th><th className="th text-right">·</th>
              </tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="transition hover:bg-white/[0.025]">
                    <td className="td font-mono text-accent whitespace-nowrap">{r.ref_no}</td>
                    <td className="td"><Badge>{FORM_META[r.form_type]?.label || r.form_type}</Badge></td>
                    <td className="td">{r.observer_name}</td>
                    <td className="td">{r.location || '—'}</td>
                    <td className="td whitespace-nowrap">{date(r.observed_on)}</td>
                    <td className="td">
                      {r.action_required ? (
                        r.action_status === 'closed' ? <Badge tone="ok">closed</Badge>
                        : <button onClick={() => closeAction(r)} className="rounded-md bg-warn/10 px-2 py-1 text-xs text-warn hover:bg-warn/20">close action →</button>
                      ) : <span className="text-ice-faint">—</span>}
                    </td>
                    <td className="td text-right">{canWrite && <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><X size={14} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Entry drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">{FORM_META[form.form_type].full}</h2>
              <button onClick={() => setDrawer(false)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Observer"><Select value={form.observer_id} onChange={(e) => pickObserver(e.target.value)} options={[{ value: '', label: form.observer_name || 'Me' }, ...employees.map((e) => ({ value: e.id, label: e.full_name }))]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Department"><Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
                <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
              </div>
              <Field label="Date"><input className="input" type="date" value={form.observed_on} onChange={(e) => setForm({ ...form, observed_on: e.target.value })} /></Field>
              <Field label="Title / summary"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>

              {form.form_type === 'ccv' && (
                <>
                  <Field label="Critical control verified"><input className="input" value={form.critical_control} onChange={(e) => setForm({ ...form, critical_control: e.target.value })} /></Field>
                  <label className="flex items-center gap-2 text-sm text-ice"><input type="checkbox" checked={form.control_effective} onChange={(e) => setForm({ ...form, control_effective: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" /> Control was in place & effective</label>
                </>
              )}
              {form.form_type === 'take5' && (
                <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                  <div className="eyebrow mb-2">Take 5 checklist</div>
                  {[['t5_stop', 'Stop — pause before starting'], ['t5_look', 'Look — identify hazards'], ['t5_assess', 'Assess — the risks'], ['t5_manage', 'Manage — controls in place']].map(([k, lbl]) => (
                    <label key={k} className="flex items-center gap-2 py-1 text-sm text-ice"><input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" /> {lbl}</label>
                  ))}
                </div>
              )}
              {form.form_type === 'pto' && (
                <>
                  <Field label="Task observed"><input className="input" value={form.task_observed} onChange={(e) => setForm({ ...form, task_observed: e.target.value })} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Safe behaviours"><input className="input" type="number" value={form.safe_behaviours} onChange={(e) => setForm({ ...form, safe_behaviours: e.target.value })} /></Field>
                    <Field label="At-risk behaviours"><input className="input" type="number" value={form.at_risk_behaviours} onChange={(e) => setForm({ ...form, at_risk_behaviours: e.target.value })} /></Field>
                  </div>
                </>
              )}

              <Field label="Details / observations"><textarea className="input min-h-[70px]" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></Field>

              <PhotoUpload label="Photos" value={form.photo_urls} onChange={(urls) => setForm({ ...form, photo_urls: urls })} entityId={form.ref_no || 'new'} />

              {/* CCV action assignment */}
              {form.form_type === 'ccv' && (
                <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-ice"><input type="checkbox" checked={form.action_required} onChange={(e) => setForm({ ...form, action_required: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" /> Raise an action to close out</label>
                  {form.action_required && (
                    <div className="mt-3 space-y-3">
                      <Field label="Action required"><textarea className="input min-h-[50px]" value={form.action_description} onChange={(e) => setForm({ ...form, action_description: e.target.value })} /></Field>
                      <Field label="Action to (responsible person)"><Select value={form.assigned_to_id} onChange={(e) => pickAssignee(e.target.value)} options={[{ value: '', label: 'Select…' }, ...employees.map((e) => ({ value: e.id, label: e.email ? e.full_name : `${e.full_name} (no email)` }))]} /></Field>
                      <Field label="Due date"><input className="input" type="date" value={form.action_due} onChange={(e) => setForm({ ...form, action_due: e.target.value })} /></Field>
                      <p className="text-[11px] text-ice-faint">On save, the assignee is emailed automatically to close this action out.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(false)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : `Log ${FORM_META[form.form_type].label}`}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function SafetyInteractions() {
  const [sub, setSub] = useState('log')
  const { rows: targets } = useTable('safety_targets')

  const tabs = [['log', 'Log & Actions'], ['kpi', 'KPI Dashboard'], ['targets', 'Role Targets']]

  return (
    <div>
      <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${sub === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>{l}</button>
        ))}
      </div>

      {sub === 'log' && <InteractionLog />}
      {sub === 'kpi' && <KpiDashboard targets={targets} />}
      {sub === 'targets' && (
        <ModuleScaffold
          eyebrow="HSE" title="Monthly Role Targets" table="safety_targets"
          newLabel="New target" emptyTitle="No targets set"
          emptyHint="Set how many CCVs, PTOs, and Take 5s each role must complete per month."
          searchKeys={['role', 'form_type']}
          columns={[
            { key: 'role', label: 'Role', render: (v) => <Badge>{v}</Badge> },
            { key: 'form_type', label: 'Type', render: (v) => <Badge tone="accent">{FORM_META[v]?.label || v}</Badge> },
            { key: 'monthly_target', label: 'Monthly target', render: (v) => <span className="font-mono">{v}</span> },
          ]}
          fields={[
            { key: 'role', label: 'Role', required: true },
            { key: 'form_type', label: 'Form type', type: 'select', options: Object.keys(FORM_META).map((k) => ({ value: k, label: FORM_META[k].full })), default: 'ccv' },
            { key: 'monthly_target', label: 'Monthly target', type: 'number', default: 0 },
          ]}
        />
      )}
    </div>
  )
}
