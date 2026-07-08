// ============================================================================
//  Ghana holiday generator
//  Fixed-date and Christian movable holidays are computed exactly. Islamic
//  holidays depend on moon sighting, so they come from a curated per-year map
//  and are labelled "(est.)" — verify and adjust in the Holiday Manager.
// ============================================================================

const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Anonymous Gregorian algorithm for Easter Sunday.
function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)   // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// First Friday of December (Farmers' Day).
function firstFridayOfDecember(year) {
  const d = new Date(year, 11, 1)
  return new Date(year, 11, 1 + ((5 - d.getDay() + 7) % 7))
}

// Curated Islamic holiday dates (estimates — subject to moon sighting).
const ISLAMIC = {
  2025: { eidFitr: '2025-03-31', eidAdha: '2025-06-07' },
  2026: { eidFitr: '2026-03-20', eidAdha: '2026-05-27' },
  2027: { eidFitr: '2027-03-10', eidAdha: '2027-05-17' },
  2028: { eidFitr: '2028-02-27', eidAdha: '2028-05-05' },
}

// Returns [{ holiday_date, name, holiday_type, country, source }]
export function ghanaHolidays(year) {
  const out = []
  const push = (dateISO, name, type) => out.push({ holiday_date: dateISO, name, holiday_type: type, country: 'Ghana', source: 'auto' })

  // Fixed-date Ghana public holidays
  push(`${year}-01-01`, "New Year's Day", 'international')
  push(`${year}-01-07`, 'Constitution Day', 'public')
  push(`${year}-03-06`, 'Independence Day', 'public')
  push(`${year}-05-01`, 'May Day (Workers\u2019 Day)', 'international')
  push(`${year}-08-04`, "Founders' Day", 'public')
  push(`${year}-09-21`, 'Kwame Nkrumah Memorial Day', 'public')
  push(`${year}-12-25`, 'Christmas Day', 'religious')
  push(`${year}-12-26`, 'Boxing Day', 'religious')

  // Christian movable (computed exactly)
  const easter = easterSunday(year)
  push(isoLocal(addDays(easter, -2)), 'Good Friday', 'religious')
  push(isoLocal(addDays(easter, 1)), 'Easter Monday', 'religious')

  // Farmers' Day — first Friday of December
  push(isoLocal(firstFridayOfDecember(year)), "Farmers' Day", 'public')

  // Islamic (curated estimates)
  const isl = ISLAMIC[year]
  if (isl) {
    push(isl.eidFitr, 'Eid al-Fitr (est.)', 'religious')
    push(isl.eidAdha, 'Eid al-Adha (est.)', 'religious')
  }

  return out.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
}

export const HOLIDAY_TYPES = ['public', 'religious', 'international', 'company']
