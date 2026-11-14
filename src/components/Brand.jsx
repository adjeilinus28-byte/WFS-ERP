import { useId } from 'react'

// WFS Enterprise mark — "Flow W": one continuous line starts at a node (the
// request), draws the W of WorkFlow, and finishes as a check mark (the work,
// done). Single source of truth for the logo; used on login, splash, and shell.
// The favicon (public/favicon.svg) and PWA icons (public/icons) use the same art.
export function WFSMark({ size = 64, className = '' }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="WFS Enterprise">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1E2A47" />
          <stop offset="1" stopColor="#0B1120" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="12" y1="16" x2="54" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FCD34D" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id}t)`} />
      <rect x="0.5" y="0.5" width="63" height="63" rx="15.5" fill="none" stroke="rgba(255,255,255,0.08)" />
      <path d="M13 23 L21.5 43 L32 28 L41 41 L53 17" fill="none" stroke={`url(#${id}s)`}
        strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="23" r="4" fill="#F1F5F9" />
    </svg>
  )
}

export default WFSMark
