import { useEffect, useMemo, useState } from 'react'
import { Printer, Wallet, Receipt, Landmark, CalendarCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, EmptyState, Badge } from '../components/ui'
import { date } from '../lib/format'
import { at } from '../lib/tr'

// Self-service payslips. The database only returns payroll rows that belong to
// the signed-in person's own employee record (matched by login email), so this
// page never sees anyone else's pay.
const n = (v) => Number(v || 0)
const amt = (v, ccy) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: ccy || 'GHS', minimumFractionDigits: 2 }).format(n(v))
const periodLabel = (p) => {
  if (!p || !/^\d{4}-\d{2}$/.test(p)) return p || '—'
  const [y, m] = p.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

const EARNINGS = [
  ['basic_pay', 'Basic pay'], ['salary_difference', 'Salary difference'],
  ['transport_allowance', 'Transport allowance'], ['canteen_allowance', 'Canteen allowance'],
  ['extra_duty_allowance', 'Extra duty allowance'], ['medical_allowance', 'Medical allowance'],
  ['fuel_allowance', 'Fuel allowance'], ['mobile_credit', 'Mobile credit'], ['allowances', 'Other allowances'],
  ['shift_overtime', 'Shift overtime'], ['weekday_overtime', 'Weekday overtime'],
  ['holiday_overtime', 'Public holiday overtime'], ['arrears_overtime', 'Arrears overtime'],
  ['bonus', 'Bonus'], ['adjustment', 'Adjustment'],
]
const DEDUCTIONS = [
  ['ssnit', 'SSNIT pension (employee share)'], ['paye_amount', 'PAYE (income tax)'],
  ['overtime_tax', 'Tax on overtime'], ['bonus_tax', 'Tax on bonus'],
  ['union_dues', 'Union dues'], ['rent_deduction', 'Rent'], ['ssnit_loan', 'SSNIT loan'],
  ['other_deductions', 'Other deductions'],
]

function Line({ label, value, ccy, strong, tone }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'border-t border-white/10 pt-3' : 'border-t border-white/[0.05]'}`}>
      <span className={strong ? 'text-sm font-semibold text-ice' : 'text-sm text-ice-dim'}>{at(label)}</span>
      <span className={`font-mono text-sm ${strong ? 'font-semibold' : ''} ${tone === 'ok' ? 'text-ok' : 'text-ice'}`}>{amt(value, ccy)}</span>
    </div>
  )
}

export default function MyPay() {
  const { activeOrgId, activeOrg } = useAuth()
  const [state, setState] = useState({ loading: true, linked: false, slips: [] })
  const [sel, setSel] = useState(null)

  useEffect(() => {
    if (!activeOrgId) return
    let alive = true
    ;(async () => {
      const { data: ids } = await supabase.rpc('my_employee_ids', { p_org: activeOrgId })
      const mine = (ids || []).map((r) => (typeof r === 'string' ? r : r.my_employee_ids || r.id)).filter(Boolean)
      if (!mine.length) { if (alive) setState({ loading: false, linked: false, slips: [] }); return }
      const { data } = await supabase.from('payroll').select('*').eq('org_id', activeOrgId)
        .in('employee_id', mine).in('status', ['approved', 'paid']).order('period', { ascending: false })
      if (!alive) return
      setState({ loading: false, linked: true, slips: data || [] })
      setSel((data || [])[0]?.id || null)
    })()
    return () => { alive = false }
  }, [activeOrgId])

  const slip = useMemo(() => state.slips.find((s) => s.id === sel) || state.slips[0], [state.slips, sel])
  const ccy = slip?.currency || activeOrg?.currency || 'GHS'
  const year = String(new Date().getFullYear())
  const ytd = state.slips.filter((s) => String(s.period || '').startsWith(year))
  const ytdNet = ytd.reduce((t, s) => t + n(s.net_pay), 0)
  const ytdTax = ytd.reduce((t, s) => t + n(s.paye_amount) + n(s.overtime_tax) + n(s.bonus_tax), 0)

  if (state.loading) return <div className="grid h-64 place-items-center text-ice-faint">{at('Loading your payslips…')}</div>

  return (
    <div>
      <PageHeader eyebrow="My account" title="My pay" sub="Your payslips once payroll is approved. Only you and payroll staff can see them.">
        {slip && <button className="btn-ghost print:hidden" onClick={() => window.print()}><Printer size={15} /> {at('Print payslip')}</button>}
      </PageHeader>

      {!state.linked ? (
        <EmptyState title="No employee record is linked to your login"
          hint="Ask HR to put your login email on your employee record. Your payslips will then appear here." />
      ) : !slip ? (
        <EmptyState title="No payslips yet" hint="Your payslip appears here once payroll for the period is approved." />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4 print:hidden">
            <StatCard label={`Net pay · ${periodLabel(slip.period)}`} value={amt(slip.net_pay, ccy)} tone="ok" icon={Wallet} />
            <StatCard label="Gross pay" value={amt(slip.gross_pay, ccy)} icon={Receipt} />
            <StatCard label="All deductions" value={amt(n(slip.gross_pay) - n(slip.net_pay), ccy)} tone="warn" icon={Landmark} />
            <StatCard label={`${year} so far (net)`} value={amt(ytdNet, ccy)} icon={CalendarCheck} sub={`${ytd.length} ${at('payslip(s)')} · ${at('tax')} ${amt(ytdTax, ccy)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Payslip */}
            <div id="payslip" className="panel p-5 lg:col-span-2 lg:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg font-bold text-ice">{activeOrg?.org_name}</div>
                  <div className="text-sm text-ice-faint">{at('Payslip')} · {periodLabel(slip.period)}</div>
                </div>
                <Badge tone={slip.status === 'paid' ? 'ok' : 'info'}>{slip.status}</Badge>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-white/[0.03] p-4 text-sm sm:grid-cols-3">
                <div><div className="text-xs text-ice-faint">{at('Employee')}</div><div className="font-medium text-ice">{slip.employee_name || '—'}</div></div>
                <div><div className="text-xs text-ice-faint">{at('Badge no.')}</div><div className="font-mono text-ice">{slip.badge_no || '—'}</div></div>
                <div><div className="text-xs text-ice-faint">{at('Department')}</div><div className="text-ice">{slip.department || '—'}</div></div>
                <div><div className="text-xs text-ice-faint">{at('Job title')}</div><div className="text-ice">{slip.job_title || '—'}</div></div>
                <div><div className="text-xs text-ice-faint">{at('Bank')}</div><div className="text-ice">{slip.bank_name || '—'}</div></div>
                <div><div className="text-xs text-ice-faint">{at('Social Security No.')}</div><div className="font-mono text-ice">{slip.social_security_no || '—'}</div></div>
              </div>

              <div className="eyebrow mb-1">{at('Earnings')}</div>
              {EARNINGS.filter(([k]) => n(slip[k]) !== 0).map(([k, l]) => <Line key={k} label={l} value={slip[k]} ccy={ccy} />)}
              <Line label="Gross pay" value={slip.gross_pay} ccy={ccy} strong />

              <div className="eyebrow mb-1 mt-5">{at('Deductions')}</div>
              {DEDUCTIONS.filter(([k]) => n(slip[k]) !== 0).map(([k, l]) => <Line key={k} label={l} value={slip[k]} ccy={ccy} />)}
              <Line label="Total deductions" value={n(slip.gross_pay) - n(slip.net_pay)} ccy={ccy} strong />

              <div className="mt-5 flex items-baseline justify-between rounded-xl bg-accent-soft px-4 py-3">
                <span className="font-display text-base font-bold text-ice">{at('Net pay')}</span>
                <span className="font-display text-xl font-bold text-accent">{amt(slip.net_pay, ccy)}</span>
              </div>

              {n(slip.ssnit_employer) > 0 && (
                <p className="mt-4 text-xs text-ice-faint">
                  {at('Paid by the company on top of your salary')}: {at('SSNIT pension (employer share)')} {amt(slip.ssnit_employer, ccy)}.
                </p>
              )}
              {slip.sent_at && <p className="mt-1 text-xs text-ice-faint">{at('Payslip emailed')} {date(slip.sent_at)}.</p>}
            </div>

            {/* History */}
            <div className="panel p-5 print:hidden lg:p-6">
              <h2 className="mb-3 font-display text-[17px] font-bold text-ice">{at('All payslips')}</h2>
              <div className="space-y-2">
                {state.slips.map((s) => (
                  <button key={s.id} onClick={() => setSel(s.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ${s.id === slip.id ? 'border border-accent-line bg-accent-soft' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                    <span>
                      <span className="block text-[13px] font-semibold text-ice">{periodLabel(s.period)}</span>
                      <span className="block text-xs capitalize text-ice-faint">{s.status}</span>
                    </span>
                    <span className="font-mono text-sm text-ice">{amt(s.net_pay, s.currency || ccy)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
