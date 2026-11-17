import { callFn } from '../lib/fn'
import { useEffect, useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard, PageHeader, Field, Select, useToast } from '../components/ui'
import DataTable from '../components/DataTable'
import FileUpload from '../components/FileUpload'
import SafetyInteractions from './SafetyInteractions'
import { date, daysUntil } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { ShieldAlert, Flame, FileWarning, ShieldCheck, FileText, Download, Printer, Plus, X, Search } from 'lucide-react'
import { useDepartments } from '../hooks/useDepartments'

const ITYPE = ['near_miss', 'injury', 'spill', 'equipment', 'environmental']
const SEV = ['low', 'medium', 'high', 'critical']
const ISTATUS = ['open', 'investigating', 'closed']

function Tabs({ tab, setTab }) {
  const items = [['incidents', 'Incidents'], ['docs', 'Compliance Documents'], ['kiosk', 'Document Kiosk'], ['safety', 'Safety Interactions']]
  return (
    <div className="tabs mb-5">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`tab ${tab === k ? 'tab-on' : ''}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

const DOC_TONE = { valid: 'ok', expiring: 'warn', critical: 'bad', expired: 'bad', no_expiry: 'mute' }
const DOC_CATEGORIES = ['permit', 'certificate', 'insurance', 'licence', 'SOP', 'form', 'policy', 'safety', 'training']

function useDocuments() {
  const { activeOrgId } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const load = () => {
    if (!activeOrgId) return
    setLoading(true)
    supabase.from('documents_status').select('*').eq('org_id', activeOrgId)
      .order('expiry_date', { ascending: true })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }
  useEffect(load, [activeOrgId])
  return { rows, loading, reload: load }
}

function ComplianceDocs() {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { rows, loading, reload } = useDocuments()
  const [drawer, setDrawer] = useState(null)
  const [saving, setSaving] = useState(false)
  const { can: _can_safety } = usePermissions()
  const canWrite = _can_safety('safety', 'edit')

  const exp = rows.filter((r) => ['expired', 'critical'].includes(r.expiry_status)).length
  const soon = rows.filter((r) => r.expiry_status === 'expiring').length

  const empty = { name: '', doc_type: '', category: '', entity_ref: '', issued_on: '', expiry_date: '', file_url: '', in_kiosk: true, description: '' }
  const [form, setForm] = useState(empty)
  const openNew = () => { setForm(empty); setDrawer('new') }
  const openEdit = (r) => { setForm({ ...empty, ...r }); setDrawer(r.id) }

  const save = async () => {
    if (!form.name) { toast.error('Document name is required'); return }
    setSaving(true)
    try {
      const payload = { org_id: activeOrgId, name: form.name, doc_type: form.doc_type, category: form.category,
        entity_ref: form.entity_ref, issued_on: form.issued_on || null, expiry_date: form.expiry_date || null,
        file_url: form.file_url, in_kiosk: form.in_kiosk, description: form.description }
      if (drawer === 'new') { const { error } = await supabase.from('documents').insert(payload); if (error) throw error }
      else { const { error } = await supabase.from('documents').update(payload).eq('id', drawer); if (error) throw error }
      toast.success('Document saved'); setDrawer(null); reload()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const del = async (r) => { if (!window.confirm(`Delete "${r.name}"?`)) return; try { await supabase.from('documents').delete().eq('id', r.id); toast.success('Deleted'); reload() } catch (e) { toast.error(e.message) } }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="eyebrow">Compliance register</div>
        {canWrite && <button className="btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Add document</button>}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Documents" value={rows.length} icon={ShieldCheck} />
        <StatCard label="Expired / critical" value={exp} tone={exp ? 'bad' : 'ok'} icon={FileWarning} />
        <StatCard label="Expiring ≤45d" value={soon} tone={soon ? 'warn' : 'ok'} icon={FileWarning} />
        <StatCard label="Valid" value={rows.filter((r) => r.expiry_status === 'valid').length} tone="ok" icon={ShieldCheck} />
      </div>
      <DataTable
        loading={loading} rows={rows} searchKeys={['name', 'doc_type', 'entity_ref']}
        emptyTitle="No compliance documents"
        emptyHint="Track permits, certificates, insurance, and licences with expiry alerts."
        onEdit={canWrite ? openEdit : undefined} onDelete={canWrite ? del : undefined}
        columns={[
          { key: 'name', label: 'Document' },
          { key: 'doc_type', label: 'Type', render: (v) => v ? <Badge>{v}</Badge> : '—' },
          { key: 'file_url', label: 'File', render: (v) => v ? <a href={v} target="_blank" rel="noreferrer" className="text-info hover:underline"><FileText size={14} className="inline" /></a> : '—' },
          { key: 'in_kiosk', label: 'Kiosk', render: (v) => v ? <Badge tone="ok">shown</Badge> : <Badge tone="mute">hidden</Badge> },
          { key: 'expiry_date', label: 'Expires', render: (v) => date(v) },
          { key: 'days_to_expiry', label: 'Days left', render: (v) => v == null ? '—' : <span className={v < 0 ? 'text-bad' : v < 45 ? 'text-warn' : ''}>{v}</span> },
          { key: 'expiry_status', label: 'Status', render: (v) => <Badge tone={DOC_TONE[v] || 'mute'}>{v.replace('_', ' ')}</Badge> },
        ]}
      />

      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(null)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">{drawer === 'new' ? 'Add Document' : 'Edit Document'}</h2>
              <button onClick={() => setDrawer(null)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Document name *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><input className="input" value={form.doc_type || ''} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} placeholder="permit, certificate…" /></Field>
                <Field label="Category"><Select value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} options={[{ value: '', label: '—' }, ...DOC_CATEGORIES.map((s) => ({ value: s, label: s }))]} /></Field>
              </div>
              <Field label="Linked to (ref)"><input className="input" value={form.entity_ref || ''} onChange={(e) => setForm({ ...form, entity_ref: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issued on"><input className="input" type="date" value={form.issued_on || ''} onChange={(e) => setForm({ ...form, issued_on: e.target.value })} /></Field>
                <Field label="Expiry date"><input className="input" type="date" value={form.expiry_date || ''} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></Field>
              </div>
              <FileUpload label="Document file" bucket="compliance-files" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                value={form.file_url} onChange={(url) => setForm({ ...form, file_url: url })}
                entityId={drawer === 'new' ? 'doc' : drawer} field="doc" />
              <label className="flex items-center gap-2 text-sm text-ice">
                <input type="checkbox" checked={!!form.in_kiosk} onChange={(e) => setForm({ ...form, in_kiosk: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                Show in Document Kiosk (downloadable by workforce)
              </label>
              <Field label="Description"><textarea className="input min-h-[60px]" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(null)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save document'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Document Kiosk: downloadable field documents, status synced from compliance ──
function DocumentKiosk() {
  const { rows, loading } = useDocuments()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')

  const kioskDocs = rows.filter((r) => r.in_kiosk && r.file_url)
  const cats = [...new Set(kioskDocs.map((r) => r.category).filter(Boolean))]
  const filtered = kioskDocs.filter((r) =>
    (!cat || r.category === cat) &&
    (!q.trim() || [r.name, r.doc_type, r.description].some((v) => String(v ?? '').toLowerCase().includes(q.toLowerCase()))))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="searchbox">
          <Search size={15} className="text-ice-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" className="w-56 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
        </div>
        <button onClick={() => setCat('')} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${cat === '' ? 'border-accent-line bg-accent-soft text-accent' : 'border-white/10 text-ice-dim hover:text-ice'}`}>All</button>
        {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${cat === c ? 'border-accent-line bg-accent-soft text-accent' : 'border-white/10 text-ice-dim hover:text-ice'}`}>{c}</button>)}
        <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} document(s)</span>
      </div>

      {loading ? <div className="panel p-8 text-center text-ice-faint">Loading…</div>
      : filtered.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <FileText size={28} className="mx-auto text-ice-faint" />
          <p className="mt-3 font-display text-lg font-bold text-ice">No documents in the kiosk yet</p>
          <p className="mt-1 text-sm text-ice-faint">Upload files in Compliance Documents and tick "Show in Document Kiosk".</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <div key={r.id} className="panel flex flex-col p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><FileText size={18} /></div>
                <Badge tone={DOC_TONE[r.expiry_status] || 'mute'}>{(r.expiry_status || 'valid').replace('_', ' ')}</Badge>
              </div>
              <h3 className="font-display text-sm font-bold text-ice">{r.name}</h3>
              {r.category && <div className="mt-0.5"><Badge>{r.category}</Badge></div>}
              {r.description && <p className="mt-2 line-clamp-2 text-xs text-ice-faint">{r.description}</p>}
              <div className="mt-1 text-[11px] text-ice-faint">
                {r.expiry_date ? `Expires ${date(r.expiry_date)}` : 'No expiry'}
                {r.days_to_expiry != null && r.days_to_expiry < 0 && <span className="text-bad"> · expired</span>}
              </div>
              <div className="mt-3 flex gap-2">
                <a href={r.file_url} target="_blank" rel="noreferrer" className="btn-primary btn-sm flex-1"><Download size={14} /> Download</a>
                <a href={r.file_url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" title="Open / print"><Printer size={14} /></a>
              </div>
              {['expired', 'critical'].includes(r.expiry_status) && (
                <p className="mt-2 rounded bg-bad/10 px-2 py-1 text-[10px] text-bad">⚠ This document is out of date — verify before field use.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


export default function HSE() {
  const [tab, setTab] = useState('incidents')
  const { options: deptOptions } = useDepartments()
  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'incidents' ? (
        <ModuleScaffold
          eyebrow="Compliance" title="HSE & Safety" sub="Incidents, severity and corrective actions." table="hse_incidents"
          newLabel="Log incident" emptyTitle="No incidents logged"
          emptyHint="Record near-misses, injuries, and environmental events with corrective actions."
          searchKeys={['incident_no', 'incident_type', 'location', 'reported_by']}
          afterSave={(rec, isNew) => {
            if (isNew && rec?.id) {
              callFn('incident-notify', { org_id: rec.org_id, incident_id: rec.id }).catch(() => {})
            }
          }}
          columns={[
            { key: 'incident_no', label: 'Ref', render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'incident_type', label: 'Type', render: (v) => <Badge>{v.replace('_', ' ')}</Badge> },
            { key: 'severity', label: 'Severity', render: (v) => <Badge tone={v === 'critical' || v === 'high' ? 'bad' : v === 'medium' ? 'warn' : 'mute'}>{v}</Badge> },
            { key: 'location', label: 'Location' },
            { key: 'occurred_at', label: 'Occurred', render: (v) => date(v) },
            { key: 'status', label: 'Status', render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'incident_no', label: 'Incident ref', required: true },
            { key: 'incident_type', label: 'Type', type: 'select', options: ITYPE.map((s) => ({ value: s, label: s.replace('_', ' ') })), default: 'near_miss' },
            { key: 'severity', label: 'Severity', type: 'select', options: SEV.map((s) => ({ value: s, label: s })), default: 'low' },
            { key: 'status', label: 'Status', type: 'select', options: ISTATUS.map((s) => ({ value: s, label: s })), default: 'open' },
            { key: 'location', label: 'Location' },
            { key: 'department', label: 'Department', type: 'select', options: deptOptions },
            { key: 'occurred_at', label: 'Occurred at', type: 'date' },
            { key: 'reported_by', label: 'Reported by' },
            { key: 'description', label: 'Description', type: 'textarea', span: true },
            { key: 'corrective_action', label: 'Corrective action', type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const open = rows.filter((r) => r.status !== 'closed').length
            const crit = rows.filter((r) => ['high', 'critical'].includes(r.severity) && r.status !== 'closed').length
            const month = rows.filter((r) => new Date(r.occurred_at) > new Date(Date.now() - 30 * 86400000)).length
            return <>
              <StatCard label="Total logged" value={rows.length} icon={ShieldAlert} />
              <StatCard label="Open" value={open} tone={open ? 'warn' : 'ok'} icon={FileWarning} />
              <StatCard label="High / critical" value={crit} tone={crit ? 'bad' : 'ok'} icon={Flame} />
              <StatCard label="Last 30 days" value={month} icon={ShieldAlert} />
            </>
          }}
        />
      ) : tab === 'docs' ? <><PageHeader eyebrow="Compliance" title="Compliance Documents" sub="Permits, licences and certificates with expiry tracking." /><ComplianceDocs /></>
        : tab === 'kiosk' ? <><PageHeader eyebrow="Compliance" title="Document Kiosk" sub="Documents shared with the workforce to view and print." /><DocumentKiosk /></>
        : <><PageHeader eyebrow="Compliance" title="Safety Interactions" sub="Field observations, critical control checks and monthly targets." /><SafetyInteractions /></>}
    </div>
  )
}
