export const money = (n, ccy = 'GHS') =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: ccy, maximumFractionDigits: 0 })
    .format(Number(n || 0))

export const num = (n) => new Intl.NumberFormat('en-GH').format(Number(n || 0))

export const date = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const daysUntil = (d) => {
  if (!d) return null
  const ms = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)
  return Math.round(ms / 86400000)
}

export const initials = (name = '') =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// Hex -> "R G B" for the --accent CSS variable
export const hexToRgbTriplet = (hex = '#F59E0B') => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(f, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
