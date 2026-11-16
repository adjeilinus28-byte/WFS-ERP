import { useEffect, useState } from 'react'
import { MapPin, Phone, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { initials } from '../lib/format'
import { trimLogo } from '../lib/logo'

// Company letterhead: logo and name on the left, contact block on the right
// (office location, address, up to two phone lines, email). Used at the top of
// every printed page (AppShell, print-only), inside documents such as the
// payslip, and as a live preview in Settings. Falls back to the company
// initials when no logo has been uploaded.
const CONTACT_COLS = 'office_location, address, contact_phone, contact_phone_2, contact_email'
const cache = {}

export function invalidateLetterhead(orgId) { delete cache[orgId] }

function useOrgContact(orgId, override) {
  const [c, setC] = useState(() => cache[orgId] || null)
  useEffect(() => {
    if (override || !orgId) return
    if (cache[orgId]) { setC(cache[orgId]); return }
    let alive = true
    supabase.from('organizations').select(CONTACT_COLS).eq('id', orgId).maybeSingle()
      .then(({ data }) => { cache[orgId] = data || {}; if (alive) setC(cache[orgId]) })
    return () => { alive = false }
  }, [orgId, override])
  return override || c || {}
}

// size = logo height. Wide logos keep their shape (up to ~3.5x as wide), and the
// empty border around the artwork is trimmed so it reads at that size.
export function OrgLogo({ size = 48, className = '', src: srcOverride, name: nameOverride }) {
  const { activeOrg } = useAuth()
  const name = nameOverride ?? activeOrg?.org_name ?? ''
  const raw = srcOverride ?? activeOrg?.logo_url ?? ''
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

function ContactLine({ icon: Icon, children }) {
  return (
    <div className="flex items-start justify-end gap-1.5">
      <span className="whitespace-pre-line text-right">{children}</span>
      <Icon size={11} className="mt-[3px] shrink-0 text-ice-faint" aria-hidden="true" />
    </div>
  )
}

/**
 * props:
 *  title / subtitle  document line under the company name ("Payslip · October 2026")
 *  badge             small element shown under the contact block (e.g. Paid)
 *  contact, name, logo   overrides for the Settings preview
 */
export default function Letterhead({ title, subtitle, size = 46, badge = null, contact: contactOverride, name: nameOverride, logo }) {
  const { activeOrg, activeOrgId } = useAuth()
  const c = useOrgContact(activeOrgId, contactOverride)
  const name = nameOverride ?? activeOrg?.org_name
  const phones = [c.contact_phone, c.contact_phone_2].filter((v) => v && v.trim()).join('  ·  ')
  const hasContact = c.office_location || c.address || phones || c.contact_email
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <OrgLogo size={size} src={logo} name={name} />
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight text-ice">{name}</div>
          {(title || subtitle) && (
            <div className="mt-0.5 text-sm text-ice-dim">{[title, subtitle].filter(Boolean).join(' · ')}</div>
          )}
        </div>
      </div>
      {(hasContact || badge) && (
        <div className="ml-auto max-w-xs space-y-0.5 text-[11px] leading-snug text-ice-dim">
          {c.office_location && <ContactLine icon={MapPin}><span className="font-semibold text-ice">{c.office_location}</span></ContactLine>}
          {c.address && <ContactLine icon={MapPin}>{c.address}</ContactLine>}
          {phones && <ContactLine icon={Phone}>{phones}</ContactLine>}
          {c.contact_email && <ContactLine icon={Mail}>{c.contact_email}</ContactLine>}
          {badge && <div className="flex justify-end pt-1">{badge}</div>}
        </div>
      )}
    </div>
  )
}

// Print-only letterhead shown above any printed page. Pages that render their
// own document header (marked data-print-doc) hide it — see index.css.
export function PrintLetterhead() {
  const printed = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div className="print-letterhead mb-6 hidden border-b border-white/10 pb-4 print:block">
      <Letterhead subtitle={`Printed ${printed}`} />
    </div>
  )
}
