// Shift computation: pattern cycle + anchor date + per-date overrides.
// A shift is 'day' | 'night' | 'off' (or null when no pattern assigned).

const DAY_MS = 86400000
const toDate = (v) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d }

// Compute the shift for one employee on one date.
// assignment: { pattern } where pattern = { cycle, anchor_date }
// overrides: Map keyed by 'YYYY-MM-DD' → shift
export function shiftFor(dateISO, assignment, overrides) {
  const ov = overrides?.get?.(dateISO)
  if (ov) return ov
  if (!assignment?.pattern) return null
  const { cycle, anchor_date } = assignment.pattern
  const arr = Array.isArray(cycle) ? cycle : []
  if (arr.length === 0) return null
  const diff = Math.round((toDate(dateISO) - toDate(anchor_date)) / DAY_MS)
  const idx = ((diff % arr.length) + arr.length) % arr.length
  return arr[idx]
}

// Build a quick lookup for an employee from raw table rows.
export function buildShiftContext(employeeId, assignments, patterns, overrides) {
  const mine = (assignments || []).filter((a) => a.employee_id === employeeId)
    .sort((a, b) => new Date(b.effective_from) - new Date(a.effective_from))
  const ovMap = new Map((overrides || []).filter((o) => o.employee_id === employeeId).map((o) => [o.shift_date, o.shift]))
  return {
    overrides: ovMap,
    assignmentFor(dateISO) {
      const a = mine.find((x) => toDate(x.effective_from) <= toDate(dateISO))
      if (!a) return null
      const pattern = (patterns || []).find((p) => p.id === a.pattern_id)
      return pattern ? { pattern } : null
    },
  }
}

// Shift for a date given a context from buildShiftContext.
export function shiftOn(ctx, dateISO) {
  if (!ctx) return null
  return shiftFor(dateISO, ctx.assignmentFor(dateISO), ctx.overrides)
}

// Count working days in a range using the employee's shift calendar.
// Falls back to weekday logic (skip Sat/Sun) when no pattern is assigned.
export function shiftAwareWorkingDays(startISO, endISO, ctx, { isHoliday } = {}) {
  if (!startISO || !endISO) return 0
  const start = toDate(startISO), end = toDate(endISO)
  if (end < start) return 0
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    const isoStr = cur.toISOString().slice(0, 10)
    const s = shiftOn(ctx, isoStr)
    let working
    if (s != null) working = s !== 'off'
    else { const dow = cur.getDay(); working = dow !== 0 && dow !== 6 }
    if (working && isHoliday && isHoliday(new Date(cur))) working = false
    if (working) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}
