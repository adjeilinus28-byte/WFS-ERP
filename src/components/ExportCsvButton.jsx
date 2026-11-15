import { Download } from 'lucide-react'
import { exportCsv } from '../lib/csv'
import { useAutoT } from './ui'

// Small "Export CSV" button for table toolbars.
//   columns: [[key, label]] — always explicit, so private fields are never exported by accident.
export default function ExportCsvButton({ name, columns, rows }) {
  const at = useAutoT()
  return (
    <button type="button" className="btn-ghost btn-sm" disabled={!rows?.length} title={at('Export CSV')}
      onClick={() => exportCsv(name, columns.map(([key, label]) => ({ key, label: at(label) })), rows)}>
      <Download size={13} /> <span className="hidden sm:inline">{at('Export CSV')}</span>
    </button>
  )
}
