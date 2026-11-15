import { useEffect, useMemo, useState } from 'react'
import { Search, Download, ScrollText, PlusCircle, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, EmptyState, Badge, Select } from '../components/ui'
import { exportCsv } from '../lib/csv'
import { at } from '../lib/tr'

// Read-only trail of every create, edit and delete on the main records. Rows
// are written by database triggers (migration 0054) and can't be changed here.
const ENTITY = {
  assets: 'Asset', work_orders: 'Work order', inventory_items: 'Stock item', issuances: 'Issuance',
  purchase_requests: 'Purchase request', purchase_orders: 'Purchase order', goods_receipts: 'Goods receipt',
  suppliers: 'Supplier', employees: 'Employee', departments: 'Department', leave_requests: 'Leave request',
  leave_types: 'Leave type', leave_adjustments: 'Leave adjustment', payroll: 'Payslip',
  overtime_entries: 'Overtime', invoices: 'Invoice', bills: 'Bill', payments: 'Payment',
  journal_entries: 'Journal', gl_accounts: 'Ledger account', hse_incidents: 'HSE incident',
  safety_interactions: 'Safety interaction', documents: 'Document', training_sessions: 'Training session',
  shift_patterns: 'Shift pattern', employee_shift_assignments: 'Shift assignment', callout_requests: 'Callout',
  news_flash: 'Announcement', org_members: 'Team member', org_invitations: 'Invitation',
  member_permissions: 'Member permission', role_dept_scope: 'Department scope', role_domain_defaults: 'Role default',
  tax_settings: 'Tax settings', tax_bands: 'Tax band', payroll_settings: 'Payroll settings', organizations: 'Workspace',
}
const TONE = { created: 'ok', updated: 'info', deleted: 'bad' }
const when = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const pretty = (k) => k.replace(/_/g, ' ')

function detail(r) {
  const m = r.meta || {}
  if (m.status_from || (r.action === 'updated' && m.status_to)) return `${at('Status')}: ${m.status_from || '—'} → ${m.status_to || '—'}`
  if (r.action === 'updated' && Array.isArray(m.changed)) {
    const list = m.changed.slice(0, 5).map(pretty).join(', ')
    return `${at('Changed')}: ${list}${m.changed.length > 5 ? ` +${m.changed.length - 5}` : ''}`
  }
  if (r.action === 'created' && m.status_to) return `${at('Status')}: ${m.status_to}`
  return ''
}

export default function AuditLog() {
  const { activeOrgId } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [fEntity, setFEntity] = useState('')
  const [fAction, setFAction] = useState('')

  useEffect(() => {
    if (!activeOrgId) return
    let alive = true
    supabase.from('audit_log').select('*').eq('org_id', activeOrgId)
      .order('created_at', { ascending: false }).limit(1000)
      .then(({ data, error: e }) => { if (alive) { setRows(data || []); setError(e) } })
    return () => { alive = false }
  }, [activeOrgId])

  const filtered = useMemo(() => (rows || []).filter((r) => {
    if (fEntity && r.entity !== fEntity) return false
    if (fAction && r.action !== fAction) return false
    if (q.trim()) {
      const n = q.toLowerCase()
      const hay = `${r.meta?.label || ''} ${r.meta?.by || ''} ${ENTITY[r.entity] || r.entity} ${r.action}`.toLowerCase()
      if (!hay.includes(n)) return false
    }
    return true
  }), [rows, q, fEntity, fAction])

  if (rows === null) return <div className="grid h-64 place-items-center text-ice-faint">{at('Loading audit log…')}</div>

  const entities = [...new Set(rows.map((r) => r.entity))].sort()
  const today = new Date().toDateString()
  const count = (a) => rows.filter((r) => r.action === a).length

  const download = () => exportCsv('audit-log', [
    { key: 'created_at', label: 'When', value: (r) => new Date(r.created_at).toISOString() },
    { key: 'by', label: 'User', value: (r) => r.meta?.by || '' },
    { key: 'action', label: 'Action' },
    { key: 'entity', label: 'Record type', value: (r) => ENTITY[r.entity] || r.entity },
    { key: 'label', label: 'Record', value: (r) => r.meta?.label || r.entity_id || '' },
    { key: 'detail', label: 'Detail', value: detail },
  ], filtered)

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Audit log" sub="Every create, edit and delete on your records. Entries cannot be edited or deleted.">
        <button className="btn-ghost" onClick={download} disabled={!filtered.length}><Download size={15} /> {at('Export CSV')}</button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Entries today" value={rows.filter((r) => new Date(r.created_at).toDateString() === today).length} icon={ScrollText} />
        <StatCard label="Created" value={count('created')} tone="ok" icon={PlusCircle} />
        <StatCard label="Edited" value={count('updated')} tone="info" icon={Pencil} />
        <StatCard label="Deleted" value={count('deleted')} tone={count('deleted') ? 'bad' : 'ok'} icon={Trash2} />
      </div>

      <div className="toolbar mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="searchbox">
            <Search size={15} className="text-ice-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={at('Search record, user…')} aria-label={at('Search')}
              className="w-52 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
          </label>
          <div className="w-44"><Select value={fEntity} onChange={(e) => setFEntity(e.target.value)}
            options={[{ value: '', label: 'All record types' }, ...entities.map((e) => ({ value: e, label: ENTITY[e] || e }))]} /></div>
          <div className="w-36"><Select value={fAction} onChange={(e) => setFAction(e.target.value)} translateOptions
            options={[{ value: '', label: 'Any action' }, { value: 'created', label: 'Created' }, { value: 'updated', label: 'Edited' }, { value: 'deleted', label: 'Deleted' }]} /></div>
          <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} of {rows.length}{rows.length === 1000 ? '+' : ''}</span>
        </div>
      </div>

      {error ? (
        <EmptyState title="Audit log not available" hint="You may not have admin access, or the audit trail has not been switched on for this workspace yet." />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? 'No entries match these filters' : 'No activity recorded yet'}
          hint={rows.length ? 'Adjust or clear the filters.' : 'Changes made from now on will be listed here.'} />
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">{at('When')}</th><th className="th">{at('User')}</th><th className="th">{at('Action')}</th>
                <th className="th">{at('Record')}</th><th className="th">{at('Detail')}</th>
              </tr></thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => (
                  <tr key={r.id}>
                    <td className="td whitespace-nowrap font-mono text-xs text-ice-dim">{when(r.created_at)}</td>
                    <td className="td whitespace-nowrap">{r.meta?.by || '—'}</td>
                    <td className="td"><Badge tone={TONE[r.action] || 'mute'}>{at(r.action === 'updated' ? 'edited' : r.action)}</Badge></td>
                    <td className="td">
                      <span className="text-ice-faint">{at(ENTITY[r.entity] || r.entity)}</span>
                      {r.meta?.label && <span className="ml-1.5 font-medium text-ice">{r.meta.label}</span>}
                    </td>
                    <td className="td text-ice-dim">{detail(r) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && <div className="border-t border-white/[0.06] px-4 py-2.5 text-center text-xs text-ice-faint">{at('Showing the latest 300. Export CSV for the full list.')}</div>}
        </div>
      )}
    </div>
  )
}
