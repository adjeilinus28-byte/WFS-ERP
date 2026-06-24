import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

// ── Status badge ─────────────────────────────────────────────────────────────
const TONE = {
  ok:   'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  bad:  'bg-bad/10 text-bad border-bad/30',
  info: 'bg-info/10 text-info border-info/30',
  mute: 'bg-white/[0.04] text-ice-dim border-white/10',
  accent: 'bg-accent-soft text-accent border-accent-line',
}
export function Badge({ tone = 'mute', children }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${TONE[tone] || TONE.mute}`}>
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
export function StatCard({ label, value, sub, tone = 'accent', icon: Icon }) {
  return (
    <div className="panel p-4 animate-rise">
      <div className="flex items-start justify-between">
        <span className="eyebrow">{label}</span>
        {Icon && <Icon size={16} className="text-ice-faint" />}
      </div>
      <div className="mt-3 font-mono text-2xl font-medium tracking-tight text-ice">{value}</div>
      {sub && <div className={`mt-1 text-xs ${tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : 'text-ice-faint'}`}>{sub}</div>}
    </div>
  )
}

// ── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ eyebrow, title, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ice">{title}</h1>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ title, hint, action }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="h-10 w-10 rounded-lg border border-white/10 bg-white/[0.03]" />
      <p className="font-display text-lg font-bold text-ice">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ice-faint">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// ── Form field ───────────────────────────────────────────────────────────────
export function Field({ label, children, span }) {
  return (
    <label className={`block ${span ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">{label}</span>
      {children}
    </label>
  )
}

export function Select({ value, onChange, options, ...rest }) {
  return (
    <select className="input" value={value} onChange={onChange} {...rest}>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o} className="bg-navy-700">
          {o.label ?? o}
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
    setItems((x) => [...x, { id, msg, tone }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3800)
  }, [])
  const api = {
    success: (m) => push(m, 'ok'),
    error: (m) => push(m, 'bad'),
  }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id}
            className={`flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-pop animate-rise
              ${t.tone === 'bad' ? 'border-bad/40 bg-bad/10 text-bad' : 'border-ok/40 bg-ok/10 text-ok'}`}>
            {t.tone === 'bad' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span className="text-ice/90">{t.msg}</span>
            <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="ml-1 opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
