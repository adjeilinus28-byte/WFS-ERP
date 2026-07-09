// ============================================================================
//  Tax computation (graduated PAYE + overtime tax + bonus tax)
//  All rates and bands come from tax_settings / tax_bands so they can be kept
//  current without a code change. Seeded for Ghana (GRA).
//
//  DISCLAIMER: This implements the standard graduated-band mechanics. Verify
//  the band values and rates against current GRA guidance — they are amended
//  by Finance Acts. This is not tax advice.
// ============================================================================

const n = (v) => Number(v || 0)
const round2 = (v) => +(Number(v) || 0).toFixed(2)

// Ghana fallback bands (monthly, GHS) if none configured. Verify with GRA.
export const DEFAULT_GH_BANDS = [
  { band_order: 1, band_amount: 490, rate: 0 },
  { band_order: 2, band_amount: 110, rate: 5 },
  { band_order: 3, band_amount: 130, rate: 10 },
  { band_order: 4, band_amount: 3166.67, rate: 17.5 },
  { band_order: 5, band_amount: 16000, rate: 25 },
  { band_order: 6, band_amount: 30520, rate: 30 },
  { band_order: 7, band_amount: null, rate: 35 },   // remainder
]

// Apply graduated bands to a chargeable amount.
// Returns { tax, breakdown: [{ band_order, taxed, rate, tax }] }
export function applyBands(chargeable, bands) {
  const list = [...(bands?.length ? bands : DEFAULT_GH_BANDS)].sort((a, b) => a.band_order - b.band_order)
  let remaining = Math.max(0, n(chargeable))
  let tax = 0
  const breakdown = []
  for (const b of list) {
    if (remaining <= 0) break
    const width = b.band_amount == null ? Infinity : n(b.band_amount)
    const taxed = Math.min(remaining, width)
    const t = taxed * (n(b.rate) / 100)
    if (taxed > 0) breakdown.push({ band_order: b.band_order, taxed: round2(taxed), rate: n(b.rate), tax: round2(t) })
    tax += t
    remaining -= taxed
  }
  return { tax: round2(tax), breakdown }
}

// Chargeable income for PAYE = taxable cash pay − employee SSNIT.
// Overtime and bonus taxed under their own final-tax rules are EXCLUDED here
// (their non-qualifying excess is added back by the caller).
export function chargeableIncome({ taxablePay, ssnitEmployee }) {
  return Math.max(0, round2(n(taxablePay) - n(ssnitEmployee)))
}

// Ghana overtime tax for qualifying junior staff:
//   overtime up to `thresholdPct`% of monthly basic → taxed at `rateWithin`%
//   the excess above that                          → taxed at `rateExcess`%
// Returns { tax, within, excess }
export function overtimeTax(overtime, basic, s) {
  const ot = n(overtime)
  if (!ot || !s?.overtime_tax_enabled) return { tax: 0, within: 0, excess: 0 }
  const threshold = n(basic) * (n(s.overtime_threshold_pct) / 100)
  const within = Math.min(ot, threshold)
  const excess = Math.max(0, ot - threshold)
  const tax = within * (n(s.overtime_rate_within) / 100) + excess * (n(s.overtime_rate_excess) / 100)
  return { tax: round2(tax), within: round2(within), excess: round2(excess) }
}

// Ghana bonus tax: bonus up to `bonus_threshold_pct`% of ANNUAL basic is a
// final tax at `bonus_rate`%. Any excess is added to chargeable income and
// taxed at the graduated rates (returned as `excess` for the caller to add).
// Returns { tax, qualifying, excess }
export function bonusTax(bonus, monthlyBasic, s) {
  const b = n(bonus)
  if (!b || !s?.bonus_tax_enabled) return { tax: 0, qualifying: 0, excess: b }
  const annualBasic = n(monthlyBasic) * 12
  const cap = annualBasic * (n(s.bonus_threshold_pct) / 100)
  const qualifying = Math.min(b, cap)
  const excess = Math.max(0, b - cap)
  const tax = qualifying * (n(s.bonus_rate) / 100)
  return { tax: round2(tax), qualifying: round2(qualifying), excess: round2(excess) }
}

// Full statutory computation for one payslip.
// `f` = the payslip form; `settings` + `bands` from the DB.
export function computeTaxes(f, settings, bands) {
  const s = settings || {}
  const basic = n(f.basic_pay || f.monthly_basic)

  const ssnitEmployee = round2(basic * (n(s.ssnit_employee_rate ?? 5.5) / 100))
  const ssnitEmployer = round2(basic * (n(s.ssnit_employer_rate ?? 13) / 100))
  const unionDues = round2(basic * (n(s.union_dues_rate ?? 0) / 100))

  const overtime = n(f.shift_overtime) + n(f.weekday_overtime) + n(f.holiday_overtime) + n(f.arrears_overtime)
  const bonus = n(f.bonus)

  const ot = overtimeTax(overtime, basic, s)
  const bt = bonusTax(bonus, basic, s)

  // Regular taxable pay = everything except overtime and bonus (they're handled
  // under their own rules); the non-qualifying bonus excess is added back.
  const regularPay = basic
    + n(f.salary_difference) + n(f.mobile_credit) + n(f.transport_allowance)
    + n(f.canteen_allowance) + n(f.extra_duty_allowance) + n(f.medical_allowance)
    + n(f.fuel_allowance) + n(f.allowances)

  const chargeable = chargeableIncome({ taxablePay: regularPay + bt.excess, ssnitEmployee })
  const { tax: paye, breakdown } = applyBands(chargeable, bands)

  return {
    ssnitEmployee, ssnitEmployer, unionDues,
    paye, payeBreakdown: breakdown, chargeable,
    overtimeTax: ot.tax, overtimeWithin: ot.within, overtimeExcess: ot.excess,
    bonusTax: bt.tax, bonusQualifying: bt.qualifying, bonusExcess: bt.excess,
    overtimeTotal: round2(overtime),
  }
}
