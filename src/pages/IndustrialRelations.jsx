import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, statusTone, Field, Select, useToast, EmptyState } from '../components/ui'
import { date } from '../lib/format'
import {
  Inbox, ShieldQuestion, Heart, Search, Send, Phone, Check, AlertTriangle, Lock, Copy,
  MessageSquare, UserCheck, ClipboardList, TrendingUp,
} from 'lucide-react'

const CARD = { background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }
const CATEGORIES = ['harassment', 'pay', 'workload', 'safety', 'interpersonal', 'wellbeing', 'other']
const SEVERITY = ['low', 'normal', 'high', 'urgent']
const STATUS = ['new', 'reviewing', 'classified', 'referred', 'in_counselling', 'resolved', 'closed']
const PALETTE = ['rgb(var(--accent))', '#38BDF8', '#F472B6', '#34D399', '#A78BFA', '#FBBF24', '#F87171']

const genCase = () => 'IR-' + Math.random().toString(36).slice(2, 8).toUpperCase()
const genCode = () => Math.random().toString(36).slice(2, 8).toUpperCase()

function notify(payload) {
  fetch('/.netlify/functions/ir-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {})
}

// ── 1. Drop box (any worker) ─────────────────────────────────────────────────
function DropBox() {
  const { activeOrgId, user } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const [anon, setAnon] = useState(true)
  const [form, setForm] = useState({ subject: '', details: '', department: '', severity: 'normal', contact_email: '', employee_name: '' })
  const [saving, setSaving] = useState(false)
  const [issued, setIssued] = useState(null)

  const submit = async () => {
    if (!form.subject.trim()) { toast.error('Please add a short subject'); return }
    setSaving(true)
    try {
      const case_id = genCase(), access_code = genCode()
      const payload = {
        org_id: activeOrgId, case_id, access_code, anonymous: anon,
        employee_name: anon ? null : (form.employee_name || user?.email),
        contact_email: form.contact_email || (anon ? null : user?.email),
        department: form.department, subject: form.subject, details: form.details,
        severity: form.severity, status: 'new',
      }
      const { data, error } = await supabase.from('ir_concerns').insert(payload).select().single()
      if (error) throw error
      notify({ org_id: activeOrgId, concern_id: data.id, event: form.severity === 'urgent' || form.severity === 'high' ? 'urgent' : 'submitted' })
      setIssued({ case_id, access_code })
      setForm({ subject: '', details: '', department: '', severity: 'normal', contact_email: '', employee_name: '' })
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  if (issued) return (
    <div className="panel mx-auto max-w-lg p-6 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-ok/15 text-ok"><Check size={24} /></div>
      <h3 className="font-display text-lg font-bold text-ice">Concern submitted confidentially</h3>
      <p className="mt-1 text-sm text-ice-faint">Save these — you'll need both to check status or reply. They won't be shown again.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/10 bg-navy/50 p-3"><div className="text-[10px] uppercase text-ice-faint">Case ID</div><div className="font-mono text-lg font-bold text-accent">{issued.case_id}</div></div>
        <div className="rounded-lg border border-white/10 bg-navy/50 p-3"><div className="text-[10px] uppercase text-ice-faint">Access code</div><div className="font-mono text-lg font-bold text-ice">{issued.access_code}</div></div>
      </div>
      <button onClick={() => { navigator.clipboard?.writeText(`Case ${issued.case_id} / Code ${issued.access_code}`); toast.success('Copied') }} className="btn-ghost btn-sm mt-4"><Copy size={14} /> Copy</button>
      <button onClick={() => setIssued(null)} className="btn-primary btn-sm mt-4 ml-2">Done</button>
    </div>
  )

  return (
    <div className="panel mx-auto max-w-lg p-6">
      <div className="mb-4 flex items-center gap-2"><ShieldQuestion size={18} className="text-accent" /><h3 className="font-display text-lg font-bold text-ice">Log a concern</h3></div>
      <p className="mb-4 text-sm text-ice-faint">Raise a work-related concern or complaint. It's handled confidentially by the Industrial Relations officer.</p>

      <label className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 bg-navy/40 px-3 py-2.5 text-sm text-ice">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
        <Lock size={14} /> Submit anonymously (your identity won't be attached)
      </label>

      <div className="space-y-4">
        <Field label="Subject *"><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief summary" /></Field>
        <Field label="Details"><textarea className="input min-h-[100px]" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="What happened, when, and who was involved (optional)" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department (optional)"><Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
          <Field label="How urgent?"><Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} options={SEVERITY.map((s) => ({ value: s, label: s }))} /></Field>
        </div>
        {!anon && <Field label="Your name"><input className="input" value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} placeholder={user?.email} /></Field>}
        <Field label={anon ? 'Contact email (optional — for updates, kept private)' : 'Contact email'}><input className="input" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></Field>
      </div>
      <button onClick={submit} disabled={saving} className="btn-primary mt-5 w-full">{saving ? 'Submitting…' : 'Submit confidentially'}</button>
    </div>
  )
}

// ── Case lookup (anonymous worker checks status / replies) ───────────────────
function CaseLookup() {
  const toast = useToast()
  const [caseId, setCaseId] = useState('')
  const [code, setCode] = useState('')
  const [data, setData] = useState(null)
  const [reply, setReply] = useState('')

  const lookup = async () => {
    const { data: res, error } = await supabase.rpc('ir_lookup', { p_case_id: caseId.trim(), p_code: code.trim() })
    if (error || !res) { toast.error('No case found with that ID and code'); setData(null); return }
    setData(res)
  }
  const send = async () => {
    if (!reply.trim()) return
    const { data: ok } = await supabase.rpc('ir_worker_reply', { p_case_id: caseId.trim(), p_code: code.trim(), p_body: reply })
    if (ok) { setReply(''); toast.success('Reply sent'); lookup() } else toast.error('Could not send')
  }
  const consent = async () => {
    const name = window.prompt('Your name (optional):', '') || null
    const email = window.prompt('Contact email so the counsellor can arrange a call (optional):', '') || null
    const { data: ok } = await supabase.rpc('ir_worker_consent', { p_case_id: caseId.trim(), p_code: code.trim(), p_name: name, p_email: email })
    if (ok) { toast.success('Consent recorded'); lookup() }
  }

  return (
    <div className="panel mx-auto max-w-lg p-6">
      <div className="mb-4 flex items-center gap-2"><Search size={18} className="text-accent" /><h3 className="font-display text-lg font-bold text-ice">Check your case</h3></div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Case ID"><input className="input font-mono" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="IR-XXXXXX" /></Field>
        <Field label="Access code"><input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      </div>
      <button onClick={lookup} className="btn-primary btn-sm mt-3">Look up</button>

      {data && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <div><div className="font-mono text-accent">{data.case_id}</div><div className="text-sm text-ice">{data.subject}</div></div>
            <Badge tone={statusTone(data.status)}>{data.status}</Badge>
          </div>

          {data.referred && !data.consent_reveal && (
            <div className="mt-3 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-ice/90">
              Your case was referred to a counsellor. You can stay anonymous and chat here, or
              <button onClick={consent} className="ml-1 font-semibold text-accent hover:underline">consent to share your identity</button> so they can arrange a call.
            </div>
          )}

          <div className="mt-3 space-y-2">
            {(data.thread || []).map((m, i) => (
              <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.author_role === 'worker' ? 'bg-accent-soft text-ice ml-8' : 'bg-white/[0.03] text-ice/90 mr-8'}`}>
                <div className="mb-0.5 font-mono text-[10px] uppercase text-ice-faint">{m.author_role}{m.kind === 'call_request' ? ' · call request' : ''}</div>
                {m.body}
              </div>
            ))}
            {(data.thread || []).length === 0 && <p className="text-sm text-ice-faint">No messages yet.</p>}
          </div>

          <div className="mt-3 flex gap-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" className="input flex-1" />
            <button onClick={send} className="btn-primary btn-sm"><Send size={14} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 2. IRO management + analytics ────────────────────────────────────────────
function IROView() {
  const { activeOrgId } = useAuth()
  const toast = useToast()
  const { rows, loading, refresh } = useTable('ir_concerns', { order: { column: 'created_at', ascending: false } })
  const [sel, setSel] = useState(null)
  const [fStatus, setFStatus] = useState('')

  const filtered = rows.filter((r) => !fStatus || r.status === fStatus)
  const openCount = rows.filter((r) => !['resolved', 'closed'].includes(r.status)).length
  const urgent = rows.filter((r) => ['high', 'urgent'].includes(r.severity) && !['resolved', 'closed'].includes(r.status)).length

  const patch = async (id, p) => { try { const { error } = await supabase.from('ir_concerns').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; refresh(); if (sel?.id === id) setSel({ ...sel, ...p }) } catch (e) { toast.error(e.message) } }

  const refer = async (r) => {
    if (!window.confirm(`Refer ${r.case_id} to the counsellor?`)) return
    await patch(r.id, { referred_to_counsellor: true, referred_at: new Date().toISOString(), status: 'referred' })
    await supabase.from('ir_engagements').insert({ org_id: activeOrgId, concern_id: r.id, author_role: 'iro', kind: 'status', body: 'Case referred to counsellor.' })
    notify({ org_id: activeOrgId, concern_id: r.id, event: 'referred' })
    toast.success('Referred — counsellor notified')
  }

  // Analytics
  const byCat = useMemo(() => { const m = {}; rows.forEach((r) => { const k = r.category || 'unclassified'; m[k] = (m[k] || 0) + 1 }); return Object.entries(m).map(([name, value]) => ({ name, value })) }, [rows])

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total concerns" value={rows.length} icon={Inbox} />
        <StatCard label="Open" value={openCount} tone={openCount ? 'warn' : 'ok'} icon={ClipboardList} />
        <StatCard label="High / urgent" value={urgent} tone={urgent ? 'bad' : 'ok'} icon={AlertTriangle} />
        <StatCard label="Referred" value={rows.filter((r) => r.referred_to_counsellor).length} icon={UserCheck} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
            <span className="eyebrow">Concerns</span>
            <div className="w-40"><Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} options={[{ value: '', label: 'All statuses' }, ...STATUS.map((s) => ({ value: s, label: s }))]} /></div>
          </div>
          {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
          : filtered.length === 0 ? <EmptyState title="No concerns" hint="Submitted concerns appear here for review and classification." />
          : (
            <div className="max-h-[520px] overflow-y-auto">
              {filtered.map((r) => (
                <button key={r.id} onClick={() => setSel(r)} className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.03] ${sel?.id === r.id ? 'bg-white/[0.04]' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="font-mono text-xs text-accent">{r.case_id}</span>{r.anonymous && <Lock size={11} className="text-ice-faint" />}{['high', 'urgent'].includes(r.severity) && <Badge tone="bad">{r.severity}</Badge>}</div>
                    <div className="truncate text-sm text-ice">{r.subject}</div>
                  </div>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail / classify panel */}
        <div className="panel p-5">
          {!sel ? <div className="grid h-full min-h-[300px] place-items-center text-center text-sm text-ice-faint">Select a concern to classify or refer</div>
          : (
            <div>
              <div className="mb-1 flex items-center gap-2"><span className="font-mono text-accent">{sel.case_id}</span>{sel.anonymous ? <Badge tone="mute">anonymous</Badge> : <Badge>{sel.employee_name}</Badge>}</div>
              <h3 className="font-display text-base font-bold text-ice">{sel.subject}</h3>
              {sel.details && <p className="mt-2 rounded-lg bg-white/[0.03] p-3 text-sm text-ice/85">{sel.details}</p>}
              <div className="mt-2 text-xs text-ice-faint">{sel.department || 'No dept'} · logged {date(sel.created_at)}</div>

              <div className="mt-4 space-y-3">
                <Field label="Category"><Select value={sel.category || ''} onChange={(e) => patch(sel.id, { category: e.target.value, status: sel.status === 'new' ? 'classified' : sel.status })} options={[{ value: '', label: 'Classify…' }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]} /></Field>
                <Field label="Severity"><Select value={sel.severity || 'normal'} onChange={(e) => patch(sel.id, { severity: e.target.value })} options={SEVERITY.map((s) => ({ value: s, label: s }))} /></Field>
                <Field label="Status"><Select value={sel.status} onChange={(e) => patch(sel.id, { status: e.target.value })} options={STATUS.map((s) => ({ value: s, label: s }))} /></Field>
              </div>

              {!sel.referred_to_counsellor ? (
                <button onClick={() => refer(sel)} className="btn-primary mt-4 w-full"><Heart size={15} /> Refer to counsellor</button>
              ) : <div className="mt-4 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-center text-xs text-ok">Referred to counsellor</div>}
            </div>
          )}
        </div>
      </div>

      {byCat.length > 0 && (
        <div className="panel mt-4 p-5">
          <div className="eyebrow mb-4">Concerns by category (trend insight)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCat} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={CARD} />
              <Bar dataKey="value" radius={[5, 5, 0, 0]}>{byCat.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Counsellor view ──────────────────────────────────────────────────────────
function CounsellorView() {
  const { activeOrgId } = useAuth()
  const toast = useToast()
  const { rows: employees } = useTable('employees')
  const [cases, setCases] = useState([])
  const [sel, setSel] = useState(null)
  const [thread, setThread] = useState([])
  const [msg, setMsg] = useState('')

  const load = () => supabase.from('ir_concerns').select('*').eq('org_id', activeOrgId).eq('referred_to_counsellor', true).order('updated_at', { ascending: false }).then(({ data }) => setCases(data || []))
  useEffect(() => { if (activeOrgId) load() }, [activeOrgId])
  const loadThread = (c) => { setSel(c); supabase.from('ir_engagements').select('*').eq('concern_id', c.id).order('created_at').then(({ data }) => setThread(data || [])) }

  const emp = sel && sel.employee_id ? employees.find((e) => e.id === sel.employee_id) : null
  const canSeeIdentity = sel && (!sel.anonymous || sel.consent_reveal)

  const send = async (kind) => {
    const body = kind === 'call_request' ? (window.prompt('Message to accompany the call request:', 'I would like to arrange a phone call to support you. When suits you?') || '') : msg
    if (!body.trim()) return
    await supabase.from('ir_engagements').insert({ org_id: activeOrgId, concern_id: sel.id, author_role: 'counsellor', kind, body })
    await supabase.from('ir_concerns').update({ status: 'in_counselling', updated_at: new Date().toISOString() }).eq('id', sel.id)
    notify({ org_id: activeOrgId, concern_id: sel.id, event: 'engagement' })
    setMsg(''); loadThread(sel); toast.success(kind === 'call_request' ? 'Call request sent' : 'Message sent')
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="panel overflow-hidden">
        <div className="border-b border-white/[0.06] px-4 py-2.5"><span className="eyebrow">My cases</span></div>
        {cases.length === 0 ? <EmptyState title="No referred cases" hint="Cases referred by the IRO appear here." />
        : cases.map((c) => (
          <button key={c.id} onClick={() => loadThread(c)} className={`flex w-full items-center gap-2 border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.03] ${sel?.id === c.id ? 'bg-white/[0.04]' : ''}`}>
            <div className="min-w-0 flex-1"><div className="font-mono text-xs text-accent">{c.case_id}</div><div className="truncate text-sm text-ice">{c.subject}</div></div>
            {c.category && <Badge>{c.category}</Badge>}
          </button>
        ))}
      </div>

      <div className="panel p-5 lg:col-span-2">
        {!sel ? <div className="grid h-full min-h-[300px] place-items-center text-sm text-ice-faint">Select a case to engage</div>
        : (
          <div>
            <div className="flex items-center justify-between">
              <div><span className="font-mono text-accent">{sel.case_id}</span><h3 className="font-display text-base font-bold text-ice">{sel.subject}</h3></div>
              <Badge tone={statusTone(sel.status)}>{sel.status}</Badge>
            </div>

            {/* Identity block — respects anonymity */}
            <div className="mt-3 rounded-lg border border-white/10 bg-navy/40 p-3 text-sm">
              {canSeeIdentity ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-ice"><UserCheck size={14} className="text-ok" /> {sel.employee_name || emp?.full_name || 'Identified'}</div>
                  {emp && <div className="text-xs text-ice-faint">{emp.department || '—'} · {emp.position || ''}</div>}
                  {(sel.contact_email || emp?.email) && <div className="text-xs text-ice-faint">{sel.contact_email || emp?.email}</div>}
                  {emp?.phone && <div className="text-xs text-ice-faint">{emp.phone}</div>}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-ice-faint"><Lock size={14} /> Anonymous — identity withheld until the worker consents. You can still support them through the case thread.</div>
              )}
            </div>

            {sel.details && <p className="mt-3 rounded-lg bg-white/[0.03] p-3 text-sm text-ice/85">{sel.details}</p>}

            {/* Thread */}
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {thread.filter((t) => t.kind !== 'note').map((m) => (
                <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.author_role === 'counsellor' ? 'bg-accent-soft text-ice ml-8' : m.author_role === 'worker' ? 'bg-white/[0.05] mr-8' : 'bg-white/[0.02] text-ice-faint text-xs text-center'}`}>
                  {m.author_role !== 'system' && <div className="mb-0.5 font-mono text-[10px] uppercase text-ice-faint">{m.author_role}{m.kind === 'call_request' ? ' · call request' : ''}</div>}
                  {m.body}
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Write a supportive message…" className="input flex-1" />
              <button onClick={() => send('message')} className="btn-primary btn-sm"><Send size={14} /></button>
              <button onClick={() => send('call_request')} className="btn-ghost btn-sm" title="Request a phone call"><Phone size={14} /></button>
            </div>
            <p className="mt-2 text-[11px] text-ice-faint">The worker is notified of your message if they left a contact channel. Please engage with care and confidentiality.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function IndustrialRelations() {
  const { role, activeOrg, user } = useAuth()
  const email = (user?.email || '').toLowerCase()
  const isIRO = role === 'owner' || role === 'admin' || email === (activeOrg?.iro_email || '').toLowerCase()
  const isCounsellor = role === 'owner' || role === 'admin' || email === (activeOrg?.counsellor_email || '').toLowerCase()

  const tabs = [['drop', 'Log a Concern'], ['lookup', 'Check My Case']]
  if (isIRO) tabs.push(['iro', 'IR Officer'])
  if (isCounsellor) tabs.push(['counsellor', 'Counsellor'])
  const [tab, setTab] = useState('drop')

  return (
    <div>
      <PageHeader eyebrow="People · Confidential" title="Industrial Relations & Wellbeing" />
      <div className="mb-5 inline-flex flex-wrap rounded-lg border border-white/10 bg-navy/40 p-1">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>{l}</button>
        ))}
      </div>
      {tab === 'drop' && <DropBox />}
      {tab === 'lookup' && <CaseLookup />}
      {tab === 'iro' && isIRO && <IROView />}
      {tab === 'counsellor' && isCounsellor && <CounsellorView />}
    </div>
  )
}
