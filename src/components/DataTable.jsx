import { useMemo, useState } from 'react'
import { Search, Pencil, Trash2 } from 'lucide-react'
import { EmptyState, useAutoT } from './ui'

export default function DataTable({ columns, rows, loading, onEdit, onDelete, searchKeys, emptyTitle, emptyHint }) {
  const at = useAutoT()
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!q.trim()) return rows
    const needle = q.toLowerCase()
    const keys = searchKeys || columns.map((c) => c.key)
    return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(needle)))
  }, [q, rows, columns, searchKeys])

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/[0.06] p-2.5">
        <label className="searchbox w-full max-w-sm">
          <Search size={15} className="shrink-0 text-ice-faint" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={at('Search…')} aria-label={at('Search…')}
            className="w-full bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none"
          />
        </label>
        <span className="ml-auto rounded-full bg-white/[0.06] px-2.5 py-0.5 font-mono text-[11px] text-ice-dim">
          {filtered.length}{q.trim() && filtered.length !== rows.length ? ` / ${rows.length}` : ''}
        </span>
      </div>

      {loading ? (
        <div className="space-y-px p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-white/[0.03]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={emptyTitle || 'Nothing here yet'} hint={emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {columns.map((c) => <th key={c.key} className="th whitespace-nowrap">{at(c.label)}</th>)}
                {(onEdit || onDelete) && <th className="th text-right">{at('Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
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
