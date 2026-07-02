// Working-day calculation with weekend + Ghana public holiday awareness.
// Mirrors the logic from the WFS TSF Leave System.

// Fixed-date Ghana public holidays (month-day). Movable feasts (Easter, Eid)
// handled separately below where practical.
const FIXED_HOLIDAYS = {
  '01-01': 'New Year',
  '01-07': 'Constitution Day',
  '03-06': 'Independence Day',
  '05-01': 'May Day',
  '08-04': 'Founders Day',
  '09-21': 'Kwame Nkrumah Memorial Day',
  '12-25': 'Christmas',
  '12-26': 'Boxing Day',
}

// A few movable/observed dates through 2028 (Easter-linked + Eid approximations).
const MOVABLE = new Set([
  '2026-04-03','2026-04-06','2026-03-20','2026-05-27', // Good Fri, Easter Mon, Eid al-Fitr, Eid al-Adha (approx)
  '2027-03-26','2027-03-29','2027-03-10','2027-05-16',
  '2028-04-14','2028-04-17','2028-02-27','2028-05-05',
])

export function isHoliday(d) {
  const iso = d.toISOString().slice(0, 10)
  const md = iso.slice(5)
  return Boolean(FIXED_HOLIDAYS[md]) || MOVABLE.has(iso)
}

// Count working days between two dates inclusive.
// workWeekends: if true, Sat/Sun count as working days.
export function workingDays(startISO, endISO, { workWeekends = false, skipHolidays = true } = {}) {
  if (!startISO || !endISO) return 0
  const start = new Date(startISO)
  const end = new Date(endISO)
  if (end < start) return 0
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    const day = cur.getDay() // 0 Sun .. 6 Sat
    const weekend = day === 0 || day === 6
    const holiday = skipHolidays && isHoliday(cur)
    if ((workWeekends || !weekend) && !holiday) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// Days of advance notice between today and the leave start date.
export function noticeDays(startISO) {
  if (!startISO) return 0
  const start = new Date(startISO); start.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((start - today) / 86400000)
}
