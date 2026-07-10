import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { visibleModules } from '../lib/modules'
import { at } from '../lib/tr'
import { Search, CornerDownLeft, ArrowUp, ArrowDown, X, Command } from 'lucide-react'

// ── Fuzzy subsequence match with a simple relevance score ────────────────────
// "wo" matches "Work Orders"; consecutive and word-start hits score higher.
function fuzzy(needle, haystack) {
  const n = needle.toLowerCase(), h = (haystack || '').toLowerCase()
  if (!n) return 0
  // Word initials beat prefixes: "wo" → Work Orders, "cd" → Command Deck
  const initials = h.split(/\s+/).map((w) => w[0]).join('')
  if (n.length > 1 && initials.startsWith(n)) return 1200 - h.length
  if (h.startsWith(n)) return 1000 - h.length
  if (h.includes(n)) return 600 - h.indexOf(n)
  let score = 0, hi = 0, streak = 0
  for (const ch of n) {
    const idx = h.indexOf(ch, hi)
    if (idx === -1) return -1
    streak = idx === hi ? streak + 1 : 0
    score += 10 + streak * 5 + (idx === 0 || h[idx - 1] === ' ' ? 8 : 0)
    hi = idx + 1
  }
  return score
}

// Which record types to search, and how to render/route each hit.
const SOURCES = [
  { key: 'workforce', module: 'workforce', table: 'employees', label: 'Employees',
    cols: 'id, full_name, employee_no, department, position',
    match: 'full_name', title: (r) => r.full_name,
    sub: (r) => [r.employee_no, r.position, r.department].filter(Boolean).join(' · '), path: '/workforce' },
  { key: 'work_orders', module: 'work_orders', table: 'work_orders', label: 'Work Orders',
    cols: 'id, wo_number, title, status, priority',
    match: 'title', title: (r) => r.title,
    sub: (r) => [r.wo_number, r.status, r.priority].filter(Boolean).join(' · '), path: '/work-orders' },
  { key: 'assets', module: 'assets', table: 'assets', label: 'Assets',
    cols: 'id, asset_code, name, status, location',
    match: 'name', title: (r) => r.name,
    sub: (r) => [r.asset_code, r.status, r.location].filter(Boolean).join(' · '), path: '/assets' },
  { key: 'inventory', module: 'inventory', table: 'inventory_items', label: 'Inventory',
    cols: 'id, sku, name, category, qty_on_hand',
    match: 'name', title: (r) => r.name,
    sub: (r) => [r.sku, r.category, r.qty_on_hand != null ? `${r.qty_on_hand} on hand` : null].filter(Boolean).join(' · '), path: '/inventory' },
  { key: 'invoices', module: 'accounts', table: 'invoices', label: 'Invoices',
    cols: 'id, invoice_no, customer, status, total',
    match: 'customer', title: (r) => r.customer || r.invoice_no,
    sub: (r) => [r.invoice_no, r.status].filter(Boolean).join(' · '), path: '/accounts' },
]

export default function CommandPalette() {
  const { activeOrgId, activeOrg } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [records, setRecords] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const restoreRef = useRef(null)

  const mods = useMemo(() => visibleModules(activeOrg?.enabled_modules || []), [activeOrg])
  const enabled = useMemo(() => new Set(mods.map((m) => m.key)), [mods])

  // Global hotkey: Cmd/Ctrl+K toggles, "/" opens when not typing.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
      else if (e.key === '/' && !typing && !open) { e.preventDefault(); setOpen(true) }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wfs:open-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wfs:open-palette', onOpen)
    }
  }, [open])

  // Focus in on open, restore focus on close.
  useEffect(() => {
    if (open) { restoreRef.current = document.activeElement; setTimeout(() => inputRef.current?.focus(), 10) }
    else { setQ(''); setCursor(0); setRecords([]); restoreRef.current?.focus?.() }
  }, [open])

  // Debounced record search across enabled modules (RLS scopes to the tenant).
  useEffect(() => {
    if (!open || q.trim().length < 2 || !activeOrgId) { setRecords([]); return }
    const term = q.trim()
    setSearching(true)
    const id = setTimeout(async () => {
      const active = SOURCES.filter((s) => enabled.has(s.module))
      const results = await Promise.all(active.map(async (s) => {
        try {
          const { data } = await supabase.from(s.table).select(s.cols)
            .eq('org_id', activeOrgId).ilike(s.match, `%${term}%`).limit(5)
          return (data || []).map((r) => ({ kind: 'record', source: s, row: r }))
        } catch { return [] }
      }))
      setRecords(results.flat())
      setSearching(false)
    }, 220)
    return () => clearTimeout(id)
  }, [q, open, activeOrgId, enabled])

  // Navigation results, fuzzy-ranked.
  const navResults = useMemo(() => {
    if (!q.trim()) return mods.slice(0, 7).map((m) => ({ kind: 'nav', mod: m, score: 0 }))
    return mods
      .map((m) => ({ kind: 'nav', mod: m, score: Math.max(fuzzy(q, at(m.label)), fuzzy(q, m.label), fuzzy(q, m.section)) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
  }, [q, mods])

  const items = useMemo(() => [...navResults, ...records], [navResults, records])
  useEffect(() => { setCursor(0) }, [q])

  const run = (item) => {
    if (!item) return
    navigate(item.kind === 'nav' ? item.mod.path : item.source.path)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[cursor]) }
  }

  // Keep the highlighted row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  let lastGroup = null

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={at('Search')}>
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-navy-900 shadow-pop animate-rise">
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <Search size={17} className="shrink-0 text-ice-faint" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder={at('Search or jump to…')} aria-label={at('Search or jump to…')}
            className="w-full bg-transparent py-3.5 text-[15px] text-ice outline-none placeholder:text-ice-faint" />
          {searching && <span className="shrink-0 font-mono text-[10px] text-ice-faint">…</span>}
          <button onClick={() => setOpen(false)} aria-label={at('Close')} className="shrink-0 rounded p-1 text-ice-faint hover:text-ice"><X size={15} /></button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ice-faint">
              {q.trim().length >= 2 ? at('No results') : at('Type to search employees, work orders, assets, stock, invoices…')}
            </p>
          ) : items.map((item, i) => {
            const group = item.kind === 'nav' ? at('Navigation') : at(item.source.label)
            const header = group !== lastGroup ? group : null
            lastGroup = group
            const active = i === cursor
            const Icon = item.kind === 'nav' ? item.mod.icon : Search
            return (
              <div key={item.kind === 'nav' ? item.mod.key : `${item.source.key}:${item.row.id}`}>
                {header && <div className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">{header}</div>}
                <button data-idx={i} onMouseEnter={() => setCursor(i)} onClick={() => run(item)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${active ? 'bg-accent-soft' : 'hover:bg-white/[0.03]'}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-accent text-navy' : 'bg-white/[0.05] text-ice-faint'}`}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ice">
                      {item.kind === 'nav' ? at(item.mod.label) : item.source.title(item.row)}
                    </span>
                    <span className="block truncate text-[11px] text-ice-faint">
                      {item.kind === 'nav' ? at(item.mod.section) : item.source.sub(item.row)}
                    </span>
                  </span>
                  {active && <CornerDownLeft size={13} className="shrink-0 text-accent" />}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-white/[0.08] px-4 py-2 text-[10px] text-ice-faint">
          <span className="flex items-center gap-1"><ArrowUp size={10} /><ArrowDown size={10} /> {at('Navigate')}</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={10} /> {at('Open')}</span>
          <span className="ml-auto flex items-center gap-1"><Command size={10} /> K</span>
        </div>
      </div>
    </div>
  )
}
