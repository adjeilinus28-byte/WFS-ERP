// ============================================================================
//  Accounting engine — statements and ratio analysis from the trial balance.
//  Periods use the 21st–20th business month (see lib/period.js), rolled into a
//  fiscal year that starts on `fiscalYearStartMonth`.
// ============================================================================

import { businessMonthKey, businessMonthLabel } from './period'

const n = (v) => Number(v || 0)
const r2 = (v) => +(Number(v) || 0).toFixed(2)

// ── Fiscal periods ──────────────────────────────────────────────────────────
// Fiscal year label for a business-month key, given a start month (1–12).
export function fiscalYearOf(periodKey, startMonth = 1) {
  const [y, m] = periodKey.split('-').map(Number)
  const fy = m >= startMonth ? y : y - 1
  return startMonth === 1 ? String(fy) : `${fy}/${String(fy + 1).slice(-2)}`
}

// All business-month keys belonging to a fiscal year.
export function periodsInFiscalYear(fyLabel, startMonth = 1) {
  const startYear = Number(String(fyLabel).slice(0, 4))
  const out = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, startMonth - 1 + i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export const periodKeyOf = (dateInput) => businessMonthKey(dateInput)
export const periodLabelOf = (key) => businessMonthLabel(key)

// ── Aggregation ─────────────────────────────────────────────────────────────
// Collapse trial_balance rows (which are per-account-per-period) into one row
// per account, optionally restricted to a set of periods.
export function aggregateTrialBalance(rows, periods) {
  const keep = periods?.length ? new Set(periods) : null
  const m = new Map()
  for (const r of rows || []) {
    if (keep && r.period && !keep.has(r.period)) continue
    const k = r.account_id
    const cur = m.get(k) || {
      account_id: r.account_id, code: r.code, name: r.name,
      account_type: r.account_type, subtype: r.subtype,
      normal_balance: r.normal_balance, is_contra: r.is_contra,
      total_debit: 0, total_credit: 0,
    }
    cur.total_debit += n(r.total_debit)
    cur.total_credit += n(r.total_credit)
    m.set(k, cur)
  }
  return [...m.values()].map((a) => ({
    ...a,
    total_debit: r2(a.total_debit),
    total_credit: r2(a.total_credit),
    balance: r2(a.normal_balance === 'debit' ? a.total_debit - a.total_credit : a.total_credit - a.total_debit),
  })).sort((a, b) => a.code.localeCompare(b.code))
}

export function trialBalanceTotals(accounts) {
  const debit = accounts.reduce((s, a) => s + n(a.total_debit), 0)
  const credit = accounts.reduce((s, a) => s + n(a.total_credit), 0)
  return { debit: r2(debit), credit: r2(credit), balanced: Math.abs(debit - credit) < 0.01 }
}

// ── Income statement (for a period set) ─────────────────────────────────────
export function incomeStatement(accounts) {
  const of = (t) => accounts.filter((a) => a.account_type === t)
  const income = of('income')
  const expenses = of('expense')
  const cogs = expenses.filter((a) => a.subtype === 'cost_of_sales')
  const opex = expenses.filter((a) => a.subtype !== 'cost_of_sales')

  const revenue = r2(income.reduce((s, a) => s + n(a.balance), 0))
  const costOfSales = r2(cogs.reduce((s, a) => s + n(a.balance), 0))
  const grossProfit = r2(revenue - costOfSales)
  const operatingExpenses = r2(opex.reduce((s, a) => s + n(a.balance), 0))
  const netIncome = r2(grossProfit - operatingExpenses)

  return { income, expenses, cogs, opex, revenue, costOfSales, grossProfit, operatingExpenses, netIncome }
}

// ── Balance sheet ───────────────────────────────────────────────────────────
// Net income for the period flows into equity as "Current period earnings",
// which is what makes A = L + E hold before the year-end close.
export function balanceSheet(accounts, netIncome) {
  const of = (t) => accounts.filter((a) => a.account_type === t)
  const assets = of('asset')
  const liabilities = of('liability')
  const equity = of('equity')

  // Contra-assets (e.g. accumulated depreciation) reduce total assets.
  const sum = (list) => r2(list.reduce((s, a) => s + (a.is_contra ? -n(a.balance) : n(a.balance)), 0))

  const currentAssets = assets.filter((a) => a.subtype === 'current_asset')
  const fixedAssets = assets.filter((a) => a.subtype !== 'current_asset')
  const currentLiabilities = liabilities.filter((a) => a.subtype === 'current_liability')
  const longTermLiabilities = liabilities.filter((a) => a.subtype !== 'current_liability')

  const totalAssets = sum(assets)
  const totalLiabilities = sum(liabilities)
  const equityBase = sum(equity)
  const totalEquity = r2(equityBase + n(netIncome))
  const check = r2(totalAssets - (totalLiabilities + totalEquity))

  return {
    assets, liabilities, equity,
    currentAssets, fixedAssets, currentLiabilities, longTermLiabilities,
    totalCurrentAssets: sum(currentAssets), totalFixedAssets: sum(fixedAssets),
    totalCurrentLiabilities: sum(currentLiabilities), totalLongTermLiabilities: sum(longTermLiabilities),
    totalAssets, totalLiabilities, equityBase, currentEarnings: r2(netIncome), totalEquity,
    check, balanced: Math.abs(check) < 0.01,
  }
}

// ── Cash flow statement (indirect method) ───────────────────────────────────
// Requires the opening (prior) and closing balance sheets to derive movements.
const bal = (accounts, code) => n(accounts.find((a) => a.code === code)?.balance)

export function cashFlow(openingAccounts, closingAccounts, netIncome) {
  const delta = (code) => r2(bal(closingAccounts, code) - bal(openingAccounts, code))

  // Non-cash add-backs
  const depreciation = r2(n(closingAccounts.find((a) => a.code === '5500')?.balance))

  // Working-capital movements (increase in asset = cash out; increase in liability = cash in)
  const arChange = -delta('1100')
  const invChange = -delta('1200')
  const prepaidChange = -delta('1250')
  const apChange = delta('2000')
  const accruedChange = delta('2100')
  const wagesChange = delta('2200') + delta('2210') + delta('2220')

  const operating = r2(n(netIncome) + depreciation + arChange + invChange + prepaidChange + apChange + accruedChange + wagesChange)

  // Investing: movement in gross fixed assets
  const investing = r2(-delta('1500'))

  // Financing: loans and share capital
  const financing = r2(delta('2500') + delta('3000'))

  const netChange = r2(operating + investing + financing)
  const openingCash = r2(bal(openingAccounts, '1000') + bal(openingAccounts, '1010'))
  const closingCash = r2(bal(closingAccounts, '1000') + bal(closingAccounts, '1010'))
  const reconciles = Math.abs(r2(openingCash + netChange) - closingCash) < 0.01

  return {
    netIncome: r2(netIncome), depreciation,
    arChange, invChange, prepaidChange, apChange, accruedChange, wagesChange,
    operating, investing, financing, netChange,
    openingCash, closingCash, reconciles,
  }
}

// ── Ratio analysis ──────────────────────────────────────────────────────────
const div = (a, b) => (Math.abs(n(b)) < 0.0001 ? null : r2(n(a) / n(b)))
const pct = (a, b) => (Math.abs(n(b)) < 0.0001 ? null : r2((n(a) / n(b)) * 100))

export function ratios(bs, is) {
  const inventory = bal(bs.assets, '1200')
  const quickAssets = r2(bs.totalCurrentAssets - inventory)
  const cash = r2(bal(bs.assets, '1000') + bal(bs.assets, '1010'))
  const ar = bal(bs.assets, '1100')

  return [
    { group: 'Liquidity', key: 'current_ratio', label: 'Current ratio',
      value: div(bs.totalCurrentAssets, bs.totalCurrentLiabilities), suffix: '×',
      good: (v) => v >= 1.5, warn: (v) => v >= 1,
      hint: 'Current assets ÷ current liabilities. Above 1.5× is comfortable.' },
    { group: 'Liquidity', key: 'quick_ratio', label: 'Quick (acid-test) ratio',
      value: div(quickAssets, bs.totalCurrentLiabilities), suffix: '×',
      good: (v) => v >= 1, warn: (v) => v >= 0.8,
      hint: 'Excludes inventory. Above 1× means short-term debts are covered without selling stock.' },
    { group: 'Liquidity', key: 'cash_ratio', label: 'Cash ratio',
      value: div(cash, bs.totalCurrentLiabilities), suffix: '×',
      good: (v) => v >= 0.5, warn: (v) => v >= 0.2,
      hint: 'Cash ÷ current liabilities — the most conservative liquidity test.' },
    { group: 'Leverage', key: 'debt_to_equity', label: 'Debt to equity',
      value: div(bs.totalLiabilities, bs.totalEquity), suffix: '×',
      good: (v) => v <= 1, warn: (v) => v <= 2, invert: true,
      hint: 'Total liabilities ÷ equity. Lower means less reliance on borrowing.' },
    { group: 'Leverage', key: 'debt_ratio', label: 'Debt ratio',
      value: pct(bs.totalLiabilities, bs.totalAssets), suffix: '%',
      good: (v) => v <= 50, warn: (v) => v <= 70, invert: true,
      hint: 'Share of assets financed by debt.' },
    { group: 'Leverage', key: 'equity_ratio', label: 'Equity ratio',
      value: pct(bs.totalEquity, bs.totalAssets), suffix: '%',
      good: (v) => v >= 50, warn: (v) => v >= 30,
      hint: 'Share of assets financed by owners.' },
    { group: 'Profitability', key: 'gross_margin', label: 'Gross margin',
      value: pct(is.grossProfit, is.revenue), suffix: '%',
      good: (v) => v >= 30, warn: (v) => v >= 15,
      hint: 'Gross profit ÷ revenue.' },
    { group: 'Profitability', key: 'net_margin', label: 'Net profit margin',
      value: pct(is.netIncome, is.revenue), suffix: '%',
      good: (v) => v >= 10, warn: (v) => v >= 0,
      hint: 'Net income ÷ revenue.' },
    { group: 'Profitability', key: 'roa', label: 'Return on assets (ROA)',
      value: pct(is.netIncome, bs.totalAssets), suffix: '%',
      good: (v) => v >= 5, warn: (v) => v >= 0,
      hint: 'How efficiently assets generate profit.' },
    { group: 'Profitability', key: 'roe', label: 'Return on equity (ROE)',
      value: pct(is.netIncome, bs.totalEquity), suffix: '%',
      good: (v) => v >= 10, warn: (v) => v >= 0,
      hint: 'Profit generated on owners\u2019 capital.' },
    { group: 'Efficiency', key: 'working_capital', label: 'Working capital',
      value: r2(bs.totalCurrentAssets - bs.totalCurrentLiabilities), suffix: '',
      money: true, good: (v) => v > 0, warn: (v) => v >= 0,
      hint: 'Current assets − current liabilities.' },
    { group: 'Efficiency', key: 'ar_to_revenue', label: 'Receivables to revenue',
      value: pct(ar, is.revenue), suffix: '%',
      good: (v) => v <= 20, warn: (v) => v <= 35, invert: true,
      hint: 'High values suggest slow collection.' },
  ]
}

export function ratioTone(r) {
  if (r.value == null) return 'mute'
  if (r.good(r.value)) return 'ok'
  if (r.warn(r.value)) return 'warn'
  return 'bad'
}
