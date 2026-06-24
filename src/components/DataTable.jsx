import { useMemo, useState } from 'react'
import { Search, Pencil, Trash2 } from 'lucide-react'
import { EmptyState } from './ui'

export default function DataTable({ columns, rows, loading, onEdit, onDelete, searchKeys, emptyTitle, emptyHint }) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!q.trim()) return rows
    const needle = q.toLowerCase()
    const keys = searchKeys || columns.map((c) => c.key)
    return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(needle)))
  }, [q, rows, columns, searchKeys])

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <Search size={15} className="text-ice-faint" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="w-full bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none"
        />
        <span className="font-mono text-[11px] text-ice-faint">{filtered.length}</span>
      </div>

      {loading ? (
        <div className="space-y-px p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-white/[0.03]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={emptyTitle || 'Nothing here yet'} hint={emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white/[0.02]">
              <tr>
                {columns.map((c) => <th key={c.key} className="th whitespace-nowrap">{c.label}</th>)}
                {(onEdit || onDelete) && <th className="th text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="transition hover:bg-white/[0.025]">
                  {columns.map((c) => (
                    <td key={c.key} className="td whitespace-nowrap">
                      {c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}
                    </td>
                  ))}
                  {(onEdit || onDelete) && (
                    <td className="td text-right">
                      <div className="inline-flex gap-1">
                        {onEdit && (
                          <button onClick={() => onEdit(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice" title="Edit">
                            <Pencil size={14} />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
