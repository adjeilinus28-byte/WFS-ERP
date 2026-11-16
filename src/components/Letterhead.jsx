import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { initials } from '../lib/format'
import { trimLogo } from '../lib/logo'

// Company letterhead: the tenant's logo, name and contact line. Used at the top
// of every printed page (AppShell, print-only) and inside documents such as the
// payslip. Falls back to the company initials when no logo has been uploaded.
const cache = {}

function useOrgContact(orgId) {
  const [c, setC] = useState(() => cache[orgId] || null)
  useEffect(() => {
    if (!orgId || cache[orgId]) { setC(cache[orgId] || null); return }
    let alive = true
    supabase.from('organizations').select('address, contact_email, contact_phone').eq('id', orgId).maybeSingle()
      .then(({ data }) => { cache[orgId] = data || {}; if (alive) setC(cache[orgId]) })
    return () => { alive = false }
  }, [orgId])
  return c || {}
}

// size = logo height. Wide logos keep their shape (up to ~3.5x as wide), and the
// empty border around the artwork is trimmed so it reads at that size.
export function OrgLogo({ size = 48, className = '' }) {
  const { activeOrg } = useAuth()
  const name = activeOrg?.org_name || ''
  const raw = activeOrg?.logo_url || ''
  const [src, setSrc] = useState(raw)
  useEffect(() => {
    let alive = true
    setSrc(raw)
    if (raw) trimLogo(raw).then((t) => { if (alive) setSrc(t) })
    return () => { alive = false }
  }, [raw])
  if (raw) {
    return <img src={src} alt={`${name} logo`} style={{ height: size, width: 'auto', maxWidth: size * 3.5 }}
      className={`shrink-0 object-contain ${className}`} />
  }
  return (
    <span style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`grid shrink-0 place-items-center rounded-lg bg-accent-soft font-mono font-bold text-accent ${className}`}>
      {initials(name) || '—'}
    </span>
  )
}

export default function Letterhead({ title, subtitle, size = 46, right = null }) {
  const { activeOrg, activeOrgId } = useAuth()
  const c = useOrgContact(activeOrgId)
  const contact = [c.address, c.contact_email, c.contact_phone].filter(Boolean).join(' · ')
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <OrgLogo size={size} />
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight text-ice">{activeOrg?.org_name}</div>
          {contact && <div className="mt-0.5 text-xs text-ice-faint">{contact}</div>}
          {(title || subtitle) && (
            <div className="mt-1 text-sm text-ice-dim">{[title, subtitle].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </div>
      {right}
    </div>
  )
}

// Print-only letterhead shown above any printed page. Pages that render their
// own document header (marked data-print-doc) hide it — see index.css.
export function PrintLetterhead() {
  const printed = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div className="print-letterhead mb-6 hidden border-b border-white/10 pb-4 print:block">
      <Letterhead right={<div className="whitespace-nowrap pt-1 text-xs text-ice-faint">Printed {printed}</div>} />
    </div>
  )
}
