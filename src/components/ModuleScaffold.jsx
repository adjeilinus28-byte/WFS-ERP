import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTable } from '../hooks/useTable'
import { useAuth } from '../context/AuthContext'
import { useToast } from './ui'
import { PageHeader } from './ui'
import DataTable from './DataTable'
import Drawer from './Drawer'

// A whole CRUD module page in one declarative call. Each ERP screen supplies
// its table name, columns, form fields, and (optionally) a KPI strip.
//   - readOnly is auto-derived from role (viewers can't mutate)
export default function ModuleScaffold({
  eyebrow, title, table, columns, fields, searchKeys,
  kpis,                         // optional (rows) => <KPI strip/>
  newLabel = 'New record',
  emptyTitle, emptyHint,
  beforeSave,                   // optional (payload) => payload  (e.g. inject defaults)
}) {
  const { role } = useAuth()
  const toast = useToast()
  const { rows, loading, insert, update, remove } = useTable(table)
  const [drawer, setDrawer] = useState({ open: false, row: null })
  const [saving, setSaving] = useState(false)

  const canWrite = role && role !== 'viewer'

  const save = async (payload) => {
    setSaving(true)
    try {
      const body = beforeSave ? beforeSave(payload, drawer.row) : payload
      if (drawer.row) { await update(drawer.row.id, body); toast.success('Updated') }
      else { await insert(body); toast.success('Created') }
      setDrawer({ open: false, row: null })
    } catch (e) {
      toast.error(e.message || 'Save failed')
    } finally { setSaving(false) }
  }

  const del = async (row) => {
    if (!window.confirm(`Delete "${row.name || row.wo_number || row.incident_no || row.po_number || 'record'}"?`)) return
    try { await remove(row.id); toast.success('Deleted') }
    catch (e) { toast.error(e.message || 'Delete failed') }
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title}>
        {canWrite && (
          <button className="btn-primary" onClick={() => setDrawer({ open: true, row: null })}>
            <Plus size={16} /> {newLabel}
          </button>
        )}
      </PageHeader>

      {kpis && <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{kpis(rows)}</div>}

      <DataTable
        columns={columns} rows={rows} loading={loading}
        searchKeys={searchKeys}
        onEdit={canWrite ? (r) => setDrawer({ open: true, row: r }) : undefined}
        onDelete={canWrite ? del : undefined}
        emptyTitle={emptyTitle} emptyHint={emptyHint}
      />

      <Drawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, row: null })}
        title={drawer.row ? `Edit ${title}` : newLabel}
        fields={fields} initial={drawer.row} onSubmit={save} submitting={saving}
      />
    </>
  )
}
