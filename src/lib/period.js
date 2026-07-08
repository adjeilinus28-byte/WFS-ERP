// ============================================================================
//  Business month utilities
//  The business calendar month runs from the 21st of the previous month to the
//  20th of the current month, and is LABELLED BY THE MONTH IT ENDS IN.
//  e.g. 21 Jun 2026 – 20 Jul 2026  =>  "Jul 2026"  (key '2026-07').
//  Change START_DAY here to adjust the cutover across the whole app.
// ============================================================================

export const BUSINESS_MONTH_START_DAY = 21

// Which business month does a date fall into? Returns {year, month} (month 0-11)
// of the ENDING month (the label month).
export function businessMonthOf(dateInput) {
  const d = new Date(dateInput)
  let y = d.getFullYear(), m = d.getMonth()
  if (d.getDate() >= BUSINESS_MONTH_START_DAY) {
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  return { year: y, month: m }
}

// Inclusive {start, end} Date range for the business month ending in (year, month 0-11).
export function businessMonthRange(year, month) {
  const end = new Date(year, month, 20)
  const start = new Date(year, month - 1, 21)
  return { start, end }
}

export function currentBusinessMonth() { return businessMonthOf(new Date()) }

// 'YYYY-MM' key of the business month a date belongs to.
export function businessMonthKey(dateInput) {
  const { year, month } = businessMonthOf(dateInput)
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// Short label from a 'YYYY-MM' business-month key.
export function businessMonthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// ISO {start, end} date strings for a 'YYYY-MM' business-month key.
export function businessMonthRangeISO(key) {
  const [y, m] = key.split('-').map(Number)
  const { start, end } = businessMonthRange(y, m - 1)
  const iso = (d) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

// Does a date fall in the current business month?
export function inCurrentBusinessMonth(dateInput) {
  return businessMonthKey(dateInput) === businessMonthKey(new Date())
}

// Do two dates share the same business month?
export function sameBusinessMonth(a, b = new Date()) {
  return businessMonthKey(a) === businessMonthKey(b)
}

// The business-month key N months before the current one (0 = current).
export function businessMonthKeyOffset(offset = 0) {
  const { year, month } = currentBusinessMonth()
  const d = new Date(year, month - offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Human label for the current business month, e.g. "21 Jun – 20 Jul".
export function currentBusinessMonthLabel() {
  const { year, month } = currentBusinessMonth()
  const { start, end } = businessMonthRange(year, month)
  const f = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${f(start)} – ${f(end)}`
}
