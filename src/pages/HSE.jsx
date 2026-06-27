import { useEffect, useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard, PageHeader } from '../components/ui'
import DataTable from '../components/DataTable'
import { date, daysUntil } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ShieldAlert, Flame, FileWarning, ShieldCheck } from 'lucide-react'
import { useDepartments } from '../hooks/useDepartments'

const ITYPE = ['near_miss', 'injury', 'spill', 'equipment', 'environmental']
const SEV = ['low', 'medium', 'high', 'critical']
const ISTATUS = ['open', 'investigating', 'closed']

function Tabs({ tab, setTab }) {
  const items = [['incidents', 'Incidents'], ['docs', 'Compliance Documents']]
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

const DOC_TONE = { valid: 'ok', expiring: 'warn', critical: 'bad', expired: 'bad', no_expiry: 'mute' }

function ComplianceDocs() {
  const { activeOrgId } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeOrgId) return
    setLoading(true)
    supabase.from('documents_status').select('*').eq('org_id', activeOrgId)
      .order('expiry_date', { ascending: true })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [activeOrgId])

  const exp = rows.filter((r) => ['expired', 'critical'].includes(r.expiry_status)).length
  const soon = rows.filter((r) => r.expiry_status === 'expiring').length

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Documents" value={rows.length} icon={ShieldCheck} />
        <StatCard label="Expired / critical" value={exp} tone={exp ? 'bad' : 'ok'} icon={FileWarning} />
        <StatCard label="Expiring ≤45d" value={soon} tone={soon ? 'warn' : 'ok'} icon={FileWarning} />
        <StatCard label="Valid" value={rows.filter((r) => r.expiry_status === 'valid').length} tone="ok" icon={ShieldCheck} />
      </div>
      <DataTable
        loading={loading} rows={rows} searchKeys={['name', 'doc_type', 'entity_ref']}
        emptyTitle="No compliance documents"
        emptyHint="Track permits, certificates, insurance, and licences with expiry alerts."
        columns={[
          { key: 'name', label: 'Document' },
          { key: 'doc_type', label: 'Type', render: (v) => v ? <Badge>{v}</Badge> : '—' },
          { key: 'entity_ref', label: 'Linked to' },
          { key: 'expiry_date', label: 'Expires', render: (v) => date(v) },
          { key: 'days_to_expiry', label: 'Days left', render: (v) => v == null ? '—' : <span className={v < 0 ? 'text-bad' : v < 45 ? 'text-warn' : ''}>{v}</span> },
          { key: 'expiry_status', label: 'Status', render: (v) => <Badge tone={DOC_TONE[v] || 'mute'}>{v.replace('_', ' ')}</Badge> },
        ]}
      />
    </>
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
          eyebrow="Compliance" title="HSE & Safety" table="hse_incidents"
          newLabel="Log incident" emptyTitle="No incidents logged"
          emptyHint="Record near-misses, injuries, and environmental events with corrective actions."
          searchKeys={['incident_no', 'incident_type', 'location', 'reported_by']}
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
      ) : <><PageHeader eyebrow="Compliance" title="Compliance Documents" /><ComplianceDocs /></>}
    </div>
  )
}
