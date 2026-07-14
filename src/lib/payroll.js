// Payroll calculation — mirrors the Pamicor payslip structure.
// Statutory deductions (SSNIT, union dues, PAYE, overtime tax, bonus tax) can
// be auto-computed from the org's Tax & Deductions settings; manual amounts
// still win when auto-calculation is off or a value is explicitly entered.

import { computeTaxes } from './tax'

const n = (v) => Number(v || 0)
const r2 = (v) => +(Number(v) || 0).toFixed(2)

export function computePayslip(f, taxConfig) {
  const settings = taxConfig?.settings
  const bands = taxConfig?.bands
  const auto = !!settings?.auto_calculate

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
    adjustment: n(f.adjustment),
    shift_overtime: n(f.shift_overtime),
    weekday_overtime: n(f.weekday_overtime),
    holiday_overtime: n(f.holiday_overtime),
    arrears_overtime: n(f.arrears_overtime),
  }
  const gross = Object.values(earnings).reduce((s, v) => s + v, 0)

  // ── Statutory computation ──
  const t = computeTaxes(f, settings, bands)

  // Percentage-driven deductions (off basic). Fall back to legacy per-row rates.
  const ssnit = auto ? t.ssnitEmployee : r2(basic * (n(f.ssnit_rate ?? settings?.ssnit_employee_rate ?? 5.5) / 100))
  const union_dues = auto ? t.unionDues : r2(basic * (n(f.union_dues_rate ?? settings?.union_dues_rate ?? 0) / 100))
  const ssnit_employer = auto ? t.ssnitEmployer : r2(basic * (n(f.ssnit_employer_rate ?? settings?.ssnit_employer_rate ?? 13) / 100))

  // Taxes: auto value unless the user typed an override amount.
  const hasVal = (v) => v !== '' && v != null && !Number.isNaN(Number(v))
  const paye_amount    = auto && !hasVal(f.paye_amount)    ? t.paye        : n(f.paye_amount)
  const overtime_tax   = auto && !hasVal(f.overtime_tax)   ? t.overtimeTax : n(f.overtime_tax)
  const bonus_tax      = auto && !hasVal(f.bonus_tax)      ? t.bonusTax    : n(f.bonus_tax)

  const deductions = {
    ssnit,
    paye_amount,
    overtime_tax,
    bonus_tax,
    union_dues,
    rent_deduction: n(f.rent_deduction),
    ssnit_loan: n(f.ssnit_loan),
    other_deductions: n(f.other_deductions),
  }
  const totalDed = Object.values(deductions).reduce((s, v) => s + v, 0)

  const net = r2(gross - totalDed)
  const taxable = r2(gross - ssnit)

  return {
    earnings, deductions,
    gross: r2(gross), totalDed: r2(totalDed), net,
    ssnit, union_dues, ssnit_employer, taxable,
    tax: t, autoCalc: auto,
  }
}
