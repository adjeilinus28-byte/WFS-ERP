import { useEffect, useMemo, useState } from 'react'
import { Megaphone, ChevronLeft, ChevronRight, X, Sparkles, Calendar, ShieldAlert, FileText, Pin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const CAT = {
  announcement: { label: 'Announcement', icon: Megaphone, color: '#F59E0B' },
  campaign:     { label: 'Campaign',     icon: Sparkles,  color: '#A78BFA' },
  event:        { label: 'Event',        icon: Calendar,  color: '#60A5FA' },
  alert:        { label: 'Alert',        icon: ShieldAlert, color: '#F87171' },
  policy:       { label: 'Policy',       icon: FileText,  color: '#34D399' },
}

// Rotating announcement banner — the "News Flash" slider on the Command Deck.
export default function NewsFlash() {
  const { activeOrgId, user } = useAuth()
  const [items, setItems] = useState([])
  const [idx, setIdx] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!activeOrgId) return
    const today = new Date().toISOString().slice(0, 10)
    // Resolve the viewer's department (to show org-wide + their department's items)
    const loadDept = user?.email
      ? supabase.from('employees').select('department').eq('org_id', activeOrgId).ilike('email', user.email).maybeSingle().then(({ data }) => data?.department || null)
      : Promise.resolve(null)

    loadDept.then((myDept) => {
      supabase.from('news_flash').select('*').eq('org_id', activeOrgId).eq('active', true)
        .order('pinned', { ascending: false }).order('created_at', { ascending: false })
        .then(({ data }) => {
          const live = (data || []).filter((n) =>
            (!n.starts_on || n.starts_on <= today) &&
            (!n.ends_on || n.ends_on >= today) &&
            (!n.department || n.department === myDept))   // org-wide OR my department
          setItems(live)
        })
    })
  }, [activeOrgId, user])

  // Auto-rotate every 6s
  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000)
    return () => clearInterval(t)
  }, [items.length])

  if (dismissed || items.length === 0) return null
  const n = items[idx % items.length]
  const meta = CAT[n.category] || CAT.announcement
  const Icon = meta.icon

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-white/10"
      style={{ background: `linear-gradient(100deg, ${meta.color}1f, rgba(8,12,22,0.4) 60%)` }}>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${meta.color}22`, color: meta.color }}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
            {n.department && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ice-dim">{n.department}</span>}
            {n.pinned && <Pin size={11} className="text-ice-faint" />}
            {n.priority === 'high' && <span className="rounded bg-bad/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-bad">Important</span>}
          </div>
          <h3 className="truncate font-display text-base font-bold text-ice">{n.title}</h3>
          {n.body && <p className="mt-0.5 line-clamp-1 text-sm text-ice-dim">{n.body}</p>}
        </div>
        {n.link_url && (
          <a href={n.link_url} target="_blank" rel="noreferrer" className="btn-primary btn-sm shrink-0">{n.link_label || 'Learn more'}</a>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {items.length > 1 && (
            <>
              <button onClick={() => setIdx((i) => (i - 1 + items.length) % items.length)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><ChevronLeft size={16} /></button>
              <span className="font-mono text-[10px] text-ice-faint">{(idx % items.length) + 1}/{items.length}</span>
              <button onClick={() => setIdx((i) => (i + 1) % items.length)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><ChevronRight size={16} /></button>
            </>
          )}
          <button onClick={() => setDismissed(true)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><X size={15} /></button>
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex gap-1 px-5 pb-2">
          {items.map((_, i) => <div key={i} className={`h-0.5 flex-1 rounded-full transition-all ${i === idx % items.length ? 'bg-accent' : 'bg-white/10'}`} />)}
        </div>
      )}
    </div>
  )
}

export { CAT }
