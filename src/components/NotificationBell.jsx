import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, AlertTriangle, ClipboardCheck, GraduationCap, PackageMinus, Check, X } from 'lucide-react'
import { useNotifications } from '../hooks/useNotifications'
import { at } from '../lib/tr'

const KIND_ICON = { incident: AlertTriangle, approval: ClipboardCheck, cert: GraduationCap, stock: PackageMinus }
const DOT = { bad: 'bg-bad', warn: 'bg-warn', info: 'bg-info' }

export default function NotificationBell() {
  const { items, count, dismiss, dismissAll } = useNotifications()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const navigate = useNavigate()
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  // Position the portalled panel under the bell (fixed coords, right-aligned).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
  }, [open])

  // Close on outside click / Escape / scroll / resize.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const reposition = () => {
      if (!btnRef.current) return
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  const go = (n) => { setOpen(false); navigate(n.link) }

  // Explicit, opaque panel colour per theme (the app toggles `.light` on <html>).
  const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('light')

  // The panel is rendered into <body> via a portal so it sits above all page
  // content. Positioned absolutely inside the header, it lost the z-order fight
  // with backdrop-blurred KPI cards (which form their own stacking contexts);
  // portalling to the document root removes it from that contest entirely.
  const panel = open ? createPortal(
    <div ref={panelRef}
      className="fixed z-[9999] w-80 overflow-hidden rounded-xl border border-white/10 shadow-pop animate-fade-in"
      style={{ top: pos.top, right: pos.right, backgroundColor: isLight ? '#FFFFFF' : '#0E1424' }}
      role="dialog" aria-label={at('Notifications')}>
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
        <span className="font-display text-sm font-bold text-ice">{at('Notifications')}</span>
        {count > 0 && (
          <button onClick={dismissAll} className="flex items-center gap-1 text-[11px] text-ice-faint hover:text-ice">
            <Check size={12} /> {at('Mark all read')}
          </button>
        )}
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {count === 0 ? (
          <div className="px-4 py-10 text-center">
            <Check size={26} className="mx-auto mb-2 text-ok" />
            <p className="text-sm text-ice-faint">{at('All caught up')}</p>
          </div>
        ) : items.map((n) => {
          const Icon = KIND_ICON[n.kind] || Bell
          return (
            <div key={n.ref_id} className="group flex items-start gap-3 border-b border-white/[0.06] px-4 py-3 hover:bg-black/[0.03]">
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.severity] || 'bg-info'}`} />
              <button onClick={() => go(n)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5 text-sm text-ice">
                  <Icon size={13} className="shrink-0 text-ice-faint" />
                  <span className="truncate">{n.title}</span>
                </span>
                {n.detail && <span className="mt-0.5 block truncate text-[11px] text-ice-faint">{n.detail}</span>}
              </button>
              <button onClick={() => dismiss(n.ref_id)} aria-label={at('Dismiss')}
                className="shrink-0 rounded p-1 text-ice-faint opacity-0 transition hover:text-ice group-hover:opacity-100">
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)}
        className="icon-btn relative"
        aria-label={at('Notifications')} title={at('Notifications')}>
        <Bell size={17} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {panel}
    </div>
  )
}
