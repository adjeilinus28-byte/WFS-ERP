// Payroll calculation — mirrors the Pamicor payslip structure.
// Percentage deductions (SSNIT, union dues) compute off basic salary.

const n = (v) => Number(v || 0)

export function computePayslip(f) {
  const basic = n(f.basic_pay || f.monthly_basic)

  // ── Earnings ──
  const earnings = {
    basic,
    salary_difference: n(f.salary_difference),
    mobile_credit: n(f.mobile_credit),
    transport_allowance: n(f.transport_allowance),
    canteen_allowance: n(f.canteen_allowance),
    extra_duty_allowance: n(f.extra_duty_allowance),
    medical_allowance: n(f.medical_allowance),
    fuel_allowance: n(f.fuel_allowance),
    bonus: n(f.bonus),
    allowances: n(f.allowances),
    shift_overtime: n(f.shift_overtime),
    weekday_overtime: n(f.weekday_overtime),
    holiday_overtime: n(f.holiday_overtime),
    arrears_overtime: n(f.arrears_overtime),
  }
  const gross = Object.values(earnings).reduce((s, v) => s + v, 0)

  // ── Percentage-driven statutory deductions (off basic) ──
  const ssnit = +(basic * (n(f.ssnit_rate ?? 5.5) / 100)).toFixed(2)          // employee SSF
  const union_dues = +(basic * (n(f.union_dues_rate) / 100)).toFixed(2)
  const ssnit_employer = +(basic * (n(f.ssnit_employer_rate ?? 13) / 100)).toFixed(2)

  const deductions = {
    ssnit,
    paye_amount: n(f.paye_amount),
    overtime_tax: n(f.overtime_tax),
    union_dues,
    rent_deduction: n(f.rent_deduction),
    ssnit_loan: n(f.ssnit_loan),
    other_deductions: n(f.other_deductions),
  }
  const totalDed = Object.values(deductions).reduce((s, v) => s + v, 0)

  const net = +(gross - totalDed).toFixed(2)
  // Taxable income ≈ gross − non-taxable allowances − SSNIT (simplified)
  const taxable = +(gross - ssnit).toFixed(2)

  return { earnings, deductions, gross: +gross.toFixed(2), totalDed: +totalDed.toFixed(2), net, ssnit, union_dues, ssnit_employer, taxable }
}
