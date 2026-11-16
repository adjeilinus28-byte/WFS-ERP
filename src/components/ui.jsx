import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, AlertCircle, X, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { at } from '../lib/tr'

// ── Boundary translation ─────────────────────────────────────────────────────
// Shared components auto-translate the label strings pages hand them: the
// string is slugified into a key under "str" and looked up with itself as the
// fallback — untranslated strings simply render in English. Add translations
// in src/locales/<lang>.json under "str" without touching any page.
export function useAutoT() {
  useTranslation()          // subscribe so labels re-render on language change
  return at
}

// ── Status badge ─────────────────────────────────────────────────────────────
const TONE = {
  ok:   'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  bad:  'bg-bad/10 text-bad',
  info: 'bg-info/10 text-info',
  mute: 'bg-white/[0.06] text-ice-dim',
  accent: 'bg-accent-soft text-accent',
}
// Pill with a small status dot (coloured tones only).
export function Badge({ tone = 'mute', children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${TONE[tone] || TONE.mute}`}>
      {tone !== 'mute' && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />}
      {children}
    </span>
  )
}

// Map common status strings to a tone so modules stay consistent.
export const statusTone = (s = '') => {
  const v = String(s).toLowerCase()
  if (['operational','active','done','closed','valid','received'].includes(v)) return 'ok'
  if (['maintenance','in_progress','investigating','expiring','sent','on_hold','leave','draft'].includes(v)) return 'warn'
  if (['down','critical','expired','urgent','open','high'].includes(v)) return 'bad'
  return 'mute'
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
const CHIP = {
  accent: 'bg-accent-soft text-accent',
  ok:     'bg-ok/10 text-ok',
  warn:   'bg-warn/10 text-warn',
  bad:    'bg-bad/10 text-bad',
  info:   'bg-info/10 text-info',
}
const SUB = { bad: 'text-bad', ok: 'text-ok', warn: 'text-warn' }

export function StatCard({ label, value, sub, tone = 'accent', icon: Icon }) {
  const at = useAutoT()
  return (
    <div className="kpi animate-rise">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ice-faint">{at(label)}</span>
        {Icon && <span className={`chip ${CHIP[tone] || CHIP.accent}`}><Icon size={16} /></span>}
      </div>
      <div className="mt-3 truncate font-display text-[28px] font-bold leading-tight tracking-tight text-ice">{value}</div>
      {sub && <div className={`mt-1.5 text-xs font-medium ${SUB[tone] || 'text-ice-faint'}`}>{at(sub)}</div>}
    </div>
  )
}

// ── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ eyebrow, title, sub, children, printHidden = false }) {
  const at = useAutoT()
  return (
    <div className={`mb-6 flex flex-wrap items-end justify-between gap-3 ${printHidden ? 'print:hidden' : ''}`}>
      <div>
        {eyebrow && <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">{at(eyebrow)}</div>}
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ice sm:text-[32px]">{at(title)}</h1>
        {sub && <p className="mt-1.5 text-sm text-ice-faint">{typeof sub === 'string' ? at(sub) : sub}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ title, hint, action }) {
  const at = useAutoT()
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent"><Inbox size={22} /></div>
      <p className="font-display text-lg font-bold text-ice">{at(title)}</p>
      {hint && <p className="max-w-sm text-sm text-ice-faint">{at(hint)}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ── Form field ───────────────────────────────────────────────────────────────
export function Field({ label, children, span }) {
  const at = useAutoT()
  return (
    <label className={`block ${span ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1.5 block text-xs font-medium text-ice-dim">{at(label)}</span>
      {children}
    </label>
  )
}

// Sentinel options ("", "all", "any") are always UI text — e.g. "All departments",
// "Select…". Everything else is assumed to be DATA (department names, employees,
// vendors) and is left untouched, so we never translate a database value.
// Pass translateOptions to force-translate a fixed enum list (status, priority…).
const isSentinel = (v) => v === '' || v === 'all' || v === 'any' || v == null

export function Select({ value, onChange, options, translateOptions = false, ...rest }) {
  const tr = useAutoT()
  const lbl = (o) => {
    const raw = o.label ?? o
    const val = o.value ?? o
    return (translateOptions || isSentinel(val)) ? tr(raw) : raw
  }
  return (
    <select className="input" value={value} onChange={onChange} {...rest}>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o} className="bg-navy-700">
          {lbl(o)}
        </option>
      ))}
    </select>
  )
}

// ── Toasts ───────────────────────────────────────────────────────────────────
const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((msg, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    // Toast messages are UI strings; translate through the same slug dictionary.
    setItems((x) => [...x, { id, msg: at(msg), tone }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800)
  }, [])
  const api = {
    success: (m) => push(m, 'ok'),
    error: (m) => push(m, 'bad'),
  }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} role="status"
            className={`flex items-center gap-2.5 rounded-xl border bg-navy-700 px-4 py-3 text-sm shadow-pop animate-rise
              ${t.tone === 'bad' ? 'border-bad/40 text-bad' : 'border-ok/40 text-ok'}`}>
            {t.tone === 'bad' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span className="text-ice/90">{t.msg}</span>
            <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss notification" className="ml-1 opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
