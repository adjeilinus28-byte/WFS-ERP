// WFS Enterprise operations mark: a hexagon (modular platform / industrial hub)
// framing radar arcs and connected nodes — "monitoring live operations".
// Single source of truth for the logo; used on login, splash, and shell.
export function WFSMark({ size = 64, className = '' }) {
  const s = size
  return (
    <svg viewBox="0 0 64 64" width={s} height={s} className={className} role="img" aria-label="WFS Enterprise">
      <defs>
        <linearGradient id="wfsHex" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1B2640" />
          <stop offset="1" stopColor="#0B1120" />
        </linearGradient>
      </defs>
      {/* rounded-hex tile */}
      <path d="M32 3 L54.5 16 V48 L32 61 L9.5 48 V16 Z"
        fill="url(#wfsHex)" stroke="rgba(255,255,255,0.08)" strokeWidth="1"
        strokeLinejoin="round" />
      {/* radar arcs */}
      <g fill="none" stroke="#F59E0B" strokeLinecap="round">
        <path d="M32 42 A10 10 0 0 1 42 32" strokeWidth="2.4" opacity="0.95" />
        <path d="M32 46 A14 14 0 0 1 46 32" strokeWidth="2" opacity="0.55" />
        <path d="M32 50 A18 18 0 0 1 50 32" strokeWidth="1.6" opacity="0.28" />
      </g>
      {/* connected operation nodes */}
      <g>
        <line x1="32" y1="32" x2="32" y2="18" stroke="#F59E0B" strokeWidth="1.4" opacity="0.5" />
        <line x1="32" y1="32" x2="44" y2="24" stroke="#F59E0B" strokeWidth="1.4" opacity="0.4" />
        <line x1="32" y1="32" x2="21" y2="26" stroke="#F59E0B" strokeWidth="1.4" opacity="0.4" />
        <circle cx="32" cy="32" r="3.4" fill="#F59E0B" />
        <circle cx="32" cy="18" r="2.2" fill="#F1F5F9" />
        <circle cx="44" cy="24" r="2" fill="#F59E0B" />
        <circle cx="21" cy="26" r="2" fill="#F59E0B" />
      </g>
    </svg>
  )
}

export default WFSMark
