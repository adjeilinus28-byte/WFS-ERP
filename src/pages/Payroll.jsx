import { useEffect, useMemo, useState, useCallback } from 'react'
import { Plus, X, Search, Filter, Send, Trash2, Pencil, FileText, Users, Wallet, CheckCircle2, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { StatCard, Badge, statusTone, Field, Select, useToast, EmptyState } from '../components/ui'
import { money, date, num } from '../lib/format'
import { businessMonthKey, currentBusinessMonthLabel } from '../lib/period'
import { periodFilterList } from '../lib/accounting'
import { computePayslip } from '../lib/payroll'
import { applyBands, DEFAULT_GH_BANDS } from '../lib/tax'
import { at } from '../lib/tr'

const PAY_STATUS = ['draft', 'approved', 'paid']
const thisPeriod = () => businessMonthKey(new Date())

function SubTabs({ tab, setTab }) {
  const items = [['slips', at('Payslips')], ['status', at('Status')], ['overtime', at('Overtime')], ['tax', at('Tax & Deductions')]]
  return (
    <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

// Net = basic + overtime + bonus + allowances − (tax + ssnit + other)
const money0 = (v, ccy) => money(v, ccy)

// ── Tax & Deductions settings ────────────────────────────────────────────────
function TaxSettings({ ccy, taxConfig, onSaved }) {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const canAdmin = ['owner', at('admin')].includes(role)
  const [s, setS] = useState(null)
  const [monthlyMode, setMonthlyMode] = useState('full')  // payroll_settings.monthly_mode
  const [otPolicy, setOtPolicy] = useState({ ot_method: 'multiplier', ot_multiplier: 1.5, ot_fixed_rate: 0 })
  const [bands, setBands] = useState([])
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(3000)

  useEffect(() => {
    let alive = true
    supabase.from('payroll_settings').select('monthly_mode, ot_method, ot_multiplier, ot_fixed_rate').eq('org_id', activeOrgId).maybeSingle()
      .then(({ data }) => { if (alive && data) {
        if (data.monthly_mode) setMonthlyMode(data.monthly_mode)
        setOtPolicy({ ot_method: data.ot_method || 'multiplier', ot_multiplier: data.ot_multiplier ?? 1.5, ot_fixed_rate: data.ot_fixed_rate ?? 0 })
      } })
    return () => { alive = false }
  }, [activeOrgId])

  useEffect(() => {
    if (!taxConfig) return
    setS(taxConfig.settings || { org_id: activeOrgId, country: 'GH', auto_calculate: true,
      ssnit_employee_rate: 5.5, ssnit_employer_rate: 13, union_dues_rate: 0,
      overtime_tax_enabled: true, overtime_threshold_pct: 50, overtime_rate_within: 5, overtime_rate_excess: 10,
      bonus_tax_enabled: true, bonus_threshold_pct: 15, bonus_rate: 5 })
    setBands(taxConfig.bands?.length ? taxConfig.bands : DEFAULT_GH_BANDS.map((b) => ({ ...b, org_id: activeOrgId, country: 'GH' })))
  }, [taxConfig, activeOrgId])

  if (!s) return <div className="panel p-8 text-center text-ice-faint">{at('Loading tax settings…')}</div>

  const setBand = (i, k, v) => setBands((p) => p.map((b, idx) => idx === i ? { ...b, [k]: v === '' ? (k === 'band_amount' ? null : '') : Number(v) } : b))
  const addBand = () => setBands((p) => [...p, { org_id: activeOrgId, country: s.country, band_order: p.length + 1, band_amount: 0, rate: 0 }])
  const delBand = (i) => setBands((p) => p.filter((_, idx) => idx !== i).map((b, idx) => ({ ...b, band_order: idx + 1 })))

  const save = async () => {
    setSaving(true)
    try {
      const { error: e1 } = await supabase.from('tax_settings').upsert({ ...s, org_id: activeOrgId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
      if (e1) throw e1
      await supabase.from('tax_bands').delete().eq('org_id', activeOrgId).eq('country', s.country)
      const rows = bands.map((b, i) => ({ org_id: activeOrgId, country: s.country, band_order: i + 1, band_amount: b.band_amount, rate: Number(b.rate || 0) }))
      const { error: e2 } = await supabase.from('tax_bands').insert(rows)
      if (e2) throw e2
      const { error: e3 } = await supabase.from('payroll_settings').upsert(
        { org_id: activeOrgId, monthly_mode: monthlyMode,
          ot_method: otPolicy.ot_method, ot_multiplier: Number(otPolicy.ot_multiplier || 0), ot_fixed_rate: Number(otPolicy.ot_fixed_rate || 0),
          updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
      if (e3) throw e3
      toast.success('Payroll settings saved'); onSaved?.()
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  // Live preview
  const { tax: previewTax, breakdown } = applyBands(preview, bands)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">{at('Statutory rates')}</span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ice">
              <input type="checkbox" checked={!!s.auto_calculate} disabled={!canAdmin} className="h-4 w-4 accent-[rgb(var(--accent))]"
                onChange={(e) => setS({ ...s, auto_calculate: e.target.checked })} />
              Auto-calculate on payslips
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country of operations">
              <Select value={s.country} disabled={!canAdmin} onChange={(e) => setS({ ...s, country: e.target.value })}
                options={[{ value: 'GH', label: at('Ghana (GRA)') }, { value: 'OTHER', label: at('Other / custom') }]} />
            </Field>
            <Field label="Union dues rate (% of basic)"><input className="input" type="number" step="0.1" value={s.union_dues_rate ?? 0} disabled={!canAdmin} onChange={(e) => setS({ ...s, union_dues_rate: e.target.value })} /></Field>
          </div>
        </div>

        <div className="panel p-5">
          <div className="eyebrow mb-3">{at('SSNIT / Social Security')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee contribution (% of basic)"><input className="input" type="number" step="0.1" value={s.ssnit_employee_rate ?? 5.5} disabled={!canAdmin} onChange={(e) => setS({ ...s, ssnit_employee_rate: e.target.value })} /></Field>
            <Field label="Employer contribution (% of basic)"><input className="input" type="number" step="0.1" value={s.ssnit_employer_rate ?? 13} disabled={!canAdmin} onChange={(e) => setS({ ...s, ssnit_employer_rate: e.target.value })} /></Field>
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">Ghana default: employee 5.5%, employer 13% (18.5% total). Employee SSNIT is deducted before PAYE is computed.</p>
        </div>

        <div className="panel p-5">
          <div className="eyebrow mb-3">{at('Attendance & monthly proration')}</div>
          <Field label={at('For monthly-salaried staff, how should attendance affect basic pay?')}>
            <Select value={monthlyMode} disabled={!canAdmin} onChange={(e) => setMonthlyMode(e.target.value)}
              options={[
                { value: 'full', label: at('Always full salary (attendance ignored for monthly staff)') },
                { value: 'prorate_unpaid', label: at('Prorate only for unpaid leave') },
                { value: 'prorate_all', label: at('Prorate for all absences and unpaid leave') },
              ]} />
          </Field>
          <p className="mt-2 text-[11px] text-ice-faint">{at('Daily and hourly staff are always paid by days present. This setting only governs monthly-salaried staff when you use “Generate basic from attendance”.')}</p>
        </div>

        <div className="panel p-5">
          <div className="eyebrow mb-3">{at('Overtime pay')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={at('How is overtime paid?')}>
              <Select value={otPolicy.ot_method} disabled={!canAdmin} onChange={(e) => setOtPolicy({ ...otPolicy, ot_method: e.target.value })}
                options={[{ value: 'multiplier', label: at('Multiplier of normal rate') }, { value: 'fixed', label: at('Fixed rate per hour') }]} /></Field>
            {otPolicy.ot_method === 'multiplier' ? (
              <Field label={at('Multiplier (e.g. 1.5×)')}><input className="input" type="number" step="0.1" value={otPolicy.ot_multiplier ?? 1.5} disabled={!canAdmin} onChange={(e) => setOtPolicy({ ...otPolicy, ot_multiplier: e.target.value })} /></Field>
            ) : (
              <Field label={at('Fixed rate per hour')}><input className="input" type="number" step="0.01" value={otPolicy.ot_fixed_rate ?? 0} disabled={!canAdmin} onChange={(e) => setOtPolicy({ ...otPolicy, ot_fixed_rate: e.target.value })} /></Field>
            )}
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">{at('Only approved overtime is paid. Multiplier applies to the employee’s normal hourly-equivalent rate derived from their pay setup.')}</p>
        </div>

        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">{at('Overtime tax')}</span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ice">
              <input type="checkbox" checked={!!s.overtime_tax_enabled} disabled={!canAdmin} className="h-4 w-4 accent-[rgb(var(--accent))]" onChange={(e) => setS({ ...s, overtime_tax_enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Threshold (% of basic)"><input className="input" type="number" step="1" value={s.overtime_threshold_pct ?? 50} disabled={!canAdmin} onChange={(e) => setS({ ...s, overtime_threshold_pct: e.target.value })} /></Field>
            <Field label="Rate within (%)"><input className="input" type="number" step="0.5" value={s.overtime_rate_within ?? 5} disabled={!canAdmin} onChange={(e) => setS({ ...s, overtime_rate_within: e.target.value })} /></Field>
            <Field label="Rate on excess (%)"><input className="input" type="number" step="0.5" value={s.overtime_rate_excess ?? 10} disabled={!canAdmin} onChange={(e) => setS({ ...s, overtime_rate_excess: e.target.value })} /></Field>
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">Ghana: for qualifying junior staff, overtime up to 50% of monthly basic is taxed at 5%; the excess at 10%.</p>
        </div>

        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">{at('Bonus tax')}</span>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ice">
              <input type="checkbox" checked={!!s.bonus_tax_enabled} disabled={!canAdmin} className="h-4 w-4 accent-[rgb(var(--accent))]" onChange={(e) => setS({ ...s, bonus_tax_enabled: e.target.checked })} /> Enabled
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Threshold (% of annual basic)"><input className="input" type="number" step="1" value={s.bonus_threshold_pct ?? 15} disabled={!canAdmin} onChange={(e) => setS({ ...s, bonus_threshold_pct: e.target.value })} /></Field>
            <Field label="Final tax rate (%)"><input className="input" type="number" step="0.5" value={s.bonus_rate ?? 5} disabled={!canAdmin} onChange={(e) => setS({ ...s, bonus_rate: e.target.value })} /></Field>
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">Ghana: bonus up to 15% of annual basic attracts a 5% final tax. Any excess is added to chargeable income and taxed at the graduated rates below.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="eyebrow">{at('Graduated PAYE bands (monthly)')}</span>
            {canAdmin && <button onClick={addBand} className="btn-ghost btn-sm"><Plus size={13} /> {at('Band')}</button>}
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[2rem_1fr_1fr_1.5rem] gap-2 font-mono text-[10px] uppercase text-ice-faint">
              <span>#</span><span>Band amount ({ccy})</span><span>{at('Rate (%)')}</span><span />
            </div>
            {bands.map((b, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1.5rem] items-center gap-2">
                <span className="font-mono text-xs text-ice-faint">{i + 1}</span>
                <input className="input" type="number" step="0.01" disabled={!canAdmin}
                  value={b.band_amount ?? ''} placeholder={i === bands.length - 1 ? 'Remainder' : ''}
                  onChange={(e) => setBand(i, 'band_amount', e.target.value)} />
                <input className="input" type="number" step="0.1" disabled={!canAdmin} value={b.rate ?? 0} onChange={(e) => setBand(i, 'rate', e.target.value)} />
                {canAdmin && <button onClick={() => delBand(i)} className="text-ice-faint hover:text-bad"><X size={13} /></button>}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ice-faint">Leave the last band's amount empty to mean "remainder" (all income above the previous bands).</p>
        </div>

        <div className="panel p-5">
          <div className="eyebrow mb-3">{at('Preview')}</div>
          <Field label={`Chargeable income (${ccy})`}><input className="input" type="number" value={preview} onChange={(e) => setPreview(Number(e.target.value || 0))} /></Field>
          <div className="mt-3 rounded-lg border border-white/10 bg-navy/50 p-3">
            <table className="w-full text-xs">
              <thead><tr className="text-ice-faint"><th className="py-1 text-left font-mono text-[10px] uppercase">{at('Band')}</th><th className="text-right font-mono text-[10px] uppercase">{at('Taxed')}</th><th className="text-right font-mono text-[10px] uppercase">{at('Rate')}</th><th className="text-right font-mono text-[10px] uppercase">{at('Tax')}</th></tr></thead>
              <tbody>
                {breakdown.map((b) => (
                  <tr key={b.band_order} className="border-t border-white/[0.05]">
                    <td className="py-1 text-ice-dim">{b.band_order}</td>
                    <td className="text-right font-mono text-ice">{money(b.taxed, ccy)}</td>
                    <td className="text-right font-mono text-ice-faint">{b.rate}%</td>
                    <td className="text-right font-mono text-ice">{money(b.tax, ccy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="text-sm font-semibold text-ice">{at('Total PAYE')}</span>
              <span className="font-display text-lg font-bold text-accent">{money(previewTax, ccy)}</span>
            </div>
            <div className="mt-1 text-right text-[11px] text-ice-faint">Effective rate {preview > 0 ? ((previewTax / preview) * 100).toFixed(1) : '0.0'}%</div>
          </div>
        </div>

        <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-[11px] text-ice/90">
          <b>{at('Verify before running live payroll.')}</b> These bands and rates are seeded with Ghana (GRA) values but are amended by Finance Acts. Confirm them against the current GRA schedule for your tax year. WFS Enterprise is not a tax advisor and doesn't file on your behalf.
        </div>

        {canAdmin && <button onClick={save} disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Save tax settings'}</button>}
      </div>
    </div>
  )
}

function OvertimeLog({ ccy, employees, deptOptions, canWrite }) {
  const { activeOrgId } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ employee_id: '', work_date: '', hours: '', reason: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    const { data, error } = await supabase.from('overtime_entries').select('*')
      .eq('org_id', activeOrgId).order('work_date', { ascending: false }).limit(200)
    if (error) toast.error(error.message); else setRows(data || [])
    setLoading(false)
  }, [activeOrgId, toast])
  useEffect(() => { load() }, [load])

  const bmonth = (d) => {
    // business-month key for a work date (21st→20th): if day>=21 → next month
    const dt = new Date(d + 'T00:00:00'); if (isNaN(dt)) return null
    let y = dt.getFullYear(), m = dt.getMonth() + 1
    if (dt.getDate() >= 21) { m += 1; if (m > 12) { m = 1; y += 1 } }
    return `${y}-${String(m).padStart(2, '0')}`
  }

  const add = async () => {
    if (!form.employee_id || !form.work_date || !form.hours) { toast.error(at('Employee, date and hours are required')); return }
    const emp = employees.find((e) => e.id === form.employee_id)
    setSaving(true)
    try {
      const { error } = await supabase.from('overtime_entries').insert({
        org_id: activeOrgId, employee_id: form.employee_id, employee_name: emp?.full_name || null,
        department: emp?.department || null, work_date: form.work_date, hours: Number(form.hours),
        reason: form.reason || null, period: bmonth(form.work_date), status: 'pending',
      })
      if (error) throw error
      toast.success(at('Overtime logged — awaiting approval'))
      setForm({ employee_id: '', work_date: '', hours: '', reason: '' })
      load()
    } catch (e) { toast.error(e.message || 'Failed') } finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!window.confirm(at('Delete this overtime entry?'))) return
    const { error } = await supabase.from('overtime_entries').delete().eq('id', id)
    if (error) toast.error(error.message); else { toast.success(at('Deleted')); load() }
  }

  const badge = (st) => st === 'approved' ? 'text-ok' : st === 'declined' ? 'text-bad' : 'text-warn'

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="panel p-4">
          <div className="eyebrow mb-3">{at('Log overtime')}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
              options={[{ value: '', label: at('Select employee…') }, ...employees.map((e) => ({ value: e.id, label: e.full_name }))]} />
            <input className="input" type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
            <input className="input" type="number" step="0.5" placeholder={at('Hours')} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            <button onClick={add} disabled={saving} className="btn-primary btn-sm"><Plus size={14} /> {saving ? at('Logging…') : at('Log overtime')}</button>
          </div>
          <input className="input mt-3" placeholder={at('Reason (optional)')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <p className="mt-2 text-[11px] text-ice-faint">{at('Logged overtime goes to Approvals. Only approved hours are paid, based on your overtime policy in Tax & Deductions.')}</p>
        </div>
      )}
      <div className="panel overflow-hidden">
        {loading ? <div className="p-6 text-center text-ice-faint">{at('Loading…')}</div>
        : rows.length === 0 ? <EmptyState title={at('No overtime logged')} hint={at('Log overtime above; it will route to Approvals.')} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/[0.02]"><tr>
                <th className="th">{at('Date')}</th><th className="th">{at('Employee')}</th><th className="th">{at('Dept')}</th>
                <th className="th">{at('Hours')}</th><th className="th">{at('Period')}</th><th className="th">{at('Status')}</th>
                <th className="th text-right">{at('Actions')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="td whitespace-nowrap">{date(r.work_date)}</td>
                    <td className="td">{r.employee_name || '—'}</td>
                    <td className="td">{r.department || '—'}</td>
                    <td className="td">{r.hours}</td>
                    <td className="td font-mono text-xs">{r.period || '—'}</td>
                    <td className={`td font-semibold ${badge(r.status)}`}>{at(r.status)}</td>
                    <td className="td text-right">
                      {canWrite && r.status === 'pending' && (
                        <button onClick={() => del(r.id)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Payroll({ ccy }) {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove, refresh } = useTable('payroll', { order: { column: 'period', ascending: false } })
  const { rows: employees } = useTable('employees')
  const [sub, setSub] = useState('slips')
  const [taxConfig, setTaxConfig] = useState(null)
  const [drawer, setDrawer] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const canWrite = role && role !== 'viewer'

  // Tax & deductions settings + graduated PAYE bands
  const loadTax = () => {
    if (!activeOrgId) return
    Promise.all([
      supabase.from('tax_settings').select('*').eq('org_id', activeOrgId).maybeSingle(),
      supabase.from('tax_bands').select('*').eq('org_id', activeOrgId).order('band_order'),
    ]).then(([s, b]) => setTaxConfig({ settings: s.data || null, bands: b.data || [] }))
  }
  useEffect(loadTax, [activeOrgId])

  // Filters
  const [q, setQ] = useState('')
  const [fPeriod, setFPeriod] = useState(thisPeriod())
  const [fDept, setFDept] = useState('')

  // Full fiscal-year range (calendar year) unioned with periods that have payroll
  // data, so empty months are selectable on a new org. Newest first.
  const periods = useMemo(() => {
    const data = rows.map((r) => r.period).filter(Boolean)
    return periodFilterList([...data, thisPeriod()], thisPeriod(), 1).sort().reverse()
  }, [rows])

  const filtered = useMemo(() => rows.filter((r) => {
    if (fPeriod && r.period !== fPeriod) return false
    if (fDept && r.department !== fDept) return false
    if (q.trim() && !String(r.employee_name || '').toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [rows, q, fPeriod, fDept])

  // ── Entry drawer ──
  const emptyForm = {
    period: thisPeriod(), employee_id: '', employee_name: '', department: '', email: '',
    job_title: '', badge_no: '', bank_name: '', social_security_no: '', social_security_status: 'SSF',
    no_of_shifts: '', off_days: '', leave_days: '', attendance_pct: 100, monthly_basic: '', daily_basic: '',
    // earnings
    basic_pay: '', salary_difference: '', mobile_credit: '', transport_allowance: '', canteen_allowance: '',
    extra_duty_allowance: '', medical_allowance: '', fuel_allowance: '', bonus: '', allowances: '',
    shift_overtime: '', weekday_overtime: '', holiday_overtime: '', arrears_overtime: '',
    // deductions (rates as %)
    ssnit_rate: 5.5, paye_amount: '', overtime_tax: '', bonus_tax: '', union_dues_rate: '', rent_deduction: '',
    ssnit_loan: '', other_deductions: '', ssnit_employer_rate: 13,
    status: 'draft', notes: '',
  }
  const [form, setForm] = useState(emptyForm)
  const calc = computePayslip(form, taxConfig)

  const openNew = () => { setForm(emptyForm); setDrawer('new') }
  const openEdit = (r) => {
    const merged = { ...emptyForm }
    Object.keys(r).forEach((k) => { if (r[k] !== null && r[k] !== undefined) merged[k] = r[k] })
    setForm(merged); setDrawer(r.id)
  }

  const pickEmployee = (id) => {
    const e = employees.find((x) => x.id === id)
    const allowList = Array.isArray(e?.pay_allowances) ? e.pay_allowances : []
    const allowSum = allowList.reduce((s, a) => s + Number(a.amount || 0), 0)
    setForm((f) => ({ ...f, employee_id: id,
      employee_name: e?.full_name || f.employee_name, department: e?.department || f.department,
      email: e?.email || f.email, job_title: e?.position || f.job_title, badge_no: e?.employee_no || f.badge_no,
      bank_name: e?.bank_name || f.bank_name, social_security_no: e?.ssnit_number || f.social_security_no,
      monthly_basic: f.monthly_basic, basic_pay: f.basic_pay,
      allowances: allowSum || f.allowances, allowance_breakdown: allowList }))
  }

  // Auto-fill basic + attendance from the compute engine (roster − absences −
  // unpaid leave, applied per pay type + org policy). Draft stays editable.
  const [generating, setGenerating] = useState(false)
  const generateFromAttendance = async () => {
    if (!form.employee_id) { toast.error(at('Pick an employee first')); return }
    if (!form.period) { toast.error(at('Set the period first')); return }
    setGenerating(true)
    try {
      const { data, error } = await supabase.rpc('compute_payroll_basis', {
        p_org: activeOrgId, p_period: form.period, p_employee: form.employee_id,
      })
      if (error) throw error
      const b = data || {}
      setForm((f) => ({
        ...f,
        no_of_shifts: b.days_present ?? f.no_of_shifts,
        leave_days: (Number(b.paid_leave_days || 0) + Number(b.unpaid_leave_days || 0)) || f.leave_days,
        off_days: b.absent_days ?? f.off_days,
        attendance_pct: b.standard_days ? Math.round((Number(b.days_present) / Number(b.standard_days)) * 100) : f.attendance_pct,
        monthly_basic: b.pay_type === 'monthly' ? b.pay_rate : f.monthly_basic,
        daily_basic: b.pay_type === 'daily' ? b.pay_rate : f.daily_basic,
        basic_pay: b.basic ?? f.basic_pay,
        canteen_allowance: f.canteen_allowance,
      }))
      // leave allowance → put into an allowance field if present
      if (Number(b.leave_allowance) > 0) {
        setForm((f) => ({ ...f, transport_allowance: f.transport_allowance || b.leave_allowance }))
      }
      // Also pull approved overtime pay for the period and fill the overtime field.
      try {
        const { data: otd } = await supabase.rpc('compute_overtime_pay', {
          p_org: activeOrgId, p_period: form.period, p_employee: form.employee_id,
        })
        if (otd && Number(otd.overtime_pay) > 0) {
          setForm((f) => ({ ...f, weekday_overtime: otd.overtime_pay }))
          toast.success(`${at('Basic computed from attendance')}: ${b.days_present}/${b.standard_days} ${at('days')} · ${at('overtime')} ${otd.approved_hours}${at('h')}`)
          return
        }
      } catch { /* overtime optional */ }
      toast.success(`${at('Basic computed from attendance')}: ${b.days_present}/${b.standard_days} ${at('days')}`)
    } catch (e) { toast.error(e.message || 'Compute failed') }
    finally { setGenerating(false) }
  }

  const save = async () => {
    if (!form.period || !form.employee_name) { toast.error('Period and employee are required'); return }
    setSaving(true)
    try {
      const num = (v) => (v === '' || v == null ? 0 : Number(v))
      const payload = {
        period: form.period, employee_id: form.employee_id || null, employee_name: form.employee_name,
        department: form.department, email: form.email,
        job_title: form.job_title, badge_no: form.badge_no, bank_name: form.bank_name,
        social_security_no: form.social_security_no, social_security_status: form.social_security_status,
        no_of_shifts: num(form.no_of_shifts), off_days: num(form.off_days), leave_days: num(form.leave_days),
        attendance_pct: num(form.attendance_pct), monthly_basic: num(form.monthly_basic), daily_basic: num(form.daily_basic),
        // earnings
        basic_pay: num(form.basic_pay || form.monthly_basic), salary_difference: num(form.salary_difference),
        mobile_credit: num(form.mobile_credit), transport_allowance: num(form.transport_allowance),
        canteen_allowance: num(form.canteen_allowance), extra_duty_allowance: num(form.extra_duty_allowance),
        medical_allowance: num(form.medical_allowance), fuel_allowance: num(form.fuel_allowance),
        bonus: num(form.bonus), allowances: num(form.allowances),
        shift_overtime: num(form.shift_overtime), weekday_overtime: num(form.weekday_overtime),
        holiday_overtime: num(form.holiday_overtime), arrears_overtime: num(form.arrears_overtime),
        // deductions
        ssnit_rate: num(form.ssnit_rate), ssnit: calc.ssnit, paye_amount: calc.deductions.paye_amount,
        overtime_tax: calc.deductions.overtime_tax, bonus_tax: calc.deductions.bonus_tax,
        union_dues_rate: num(form.union_dues_rate), union_dues: calc.union_dues,
        rent_deduction: num(form.rent_deduction), ssnit_loan: num(form.ssnit_loan), other_deductions: num(form.other_deductions),
        ssnit_employer_rate: num(form.ssnit_employer_rate), ssnit_employer: calc.ssnit_employer, taxable_income: calc.taxable,
        // totals
        gross_pay: calc.gross, deductions: calc.totalDed, net_pay: calc.net,
        status: form.status, notes: form.notes,
      }
      if (drawer === 'new') await insert(payload); else await update(drawer, payload)
      toast.success('Payslip saved'); setDrawer(null)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const del = async (r) => { if (!window.confirm(`Delete ${r.employee_name}'s ${r.period} slip?`)) return; try { await remove(r.id); toast.success('Deleted') } catch (e) { toast.error(e.message) } }

  // ── Generate & send ──
  const sendBatch = async (scope) => {
    const target = filtered.filter((r) => scope === 'all' ? true : r.id === scope)
    if (target.length === 0) { toast.error('Nothing to send'); return }
    const label = scope === 'all' ? `${target.length} payslip(s) for ${fPeriod}${fDept ? ` · ${fDept}` : ''}` : 'this payslip'
    if (!window.confirm(`Generate & email ${label} to employees?`)) return
    setSending(true)
    try {
      const res = await fetch('/.netlify/functions/payslip-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: activeOrgId, ids: target.map((r) => r.id) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      toast.success(`Sent ${data.sent}, skipped ${data.skipped} (no email)`)
      await refresh()
    } catch (e) { toast.error(e.message + ' — deploy the function & set BREVO_API_KEY.') } finally { setSending(false) }
  }

  // ── Status view ──
  const [status, setStatus] = useState([])
  const [statusLoading, setStatusLoading] = useState(false)
  useEffect(() => {
    if (sub !== 'status' || !activeOrgId) return
    setStatusLoading(true)
    supabase.from('payroll_status').select('*').eq('org_id', activeOrgId).order('employee_name')
      .then(({ data }) => { setStatus(data || []); setStatusLoading(false) })
  }, [sub, activeOrgId, rows])

  const totalNet = filtered.reduce((s, r) => s + Number(r.net_pay || 0), 0)
  const sentCount = filtered.filter((r) => r.payslip_sent).length

  return (
    <div>
      <SubTabs tab={sub} setTab={setSub} />

      {sub === 'slips' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Slips (filtered)" value={filtered.length} icon={FileText} />
            <StatCard label="Net total" value={money(totalNet, ccy)} tone="ok" icon={Wallet} />
            <StatCard label="Sent" value={`${sentCount}/${filtered.length}`} icon={CheckCircle2} />
            <StatCard label="Pay periods" value={periods.length} icon={Users} />
          </div>

          {/* Filter + actions bar */}
          <div className="panel mb-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-1.5">
                <Search size={15} className="text-ice-faint" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="w-40 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
              </div>
              <Filter size={14} className="text-ice-faint" />
              <div className="w-36"><Select value={fPeriod} onChange={(e) => setFPeriod(e.target.value)}
                options={[{ value: '', label: at('All periods') }, ...periods.map((p) => ({ value: p, label: p }))]} /></div>
              <div className="w-40"><Select value={fDept} onChange={(e) => setFDept(e.target.value)} options={[{ value: '', label: at('All departments') }, ...deptOptions]} /></div>
              <span className="font-mono text-[11px] text-ice-faint">{filtered.length}</span>
              <div className="ml-auto flex gap-2">
                {canWrite && <button onClick={() => sendBatch('all')} disabled={sending || filtered.length === 0} className="btn-ghost btn-sm"><Send size={13} /> {sending ? 'Sending…' : 'Generate & send all'}</button>}
                {canWrite && <button onClick={openNew} className="btn-primary btn-sm"><Plus size={14} /> {at('New slip')}</button>}
              </div>
            </div>
          </div>

          <div className="panel overflow-hidden">
            {loading ? <div className="p-6 text-center text-ice-faint">{at('Loading…')}</div>
            : filtered.length === 0 ? <EmptyState title="No payslips for this filter" hint="Add a slip or change the period/department filter." />
            : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/[0.02]"><tr>
                    <th className="th">{at('Period')}</th><th className="th">{at('Employee')}</th><th className="th">{at('Dept')}</th>
                    <th className="th">{at('Gross')}</th><th className="th">{at('Deductions')}</th><th className="th">{at('Net')}</th>
                    <th className="th">{at('Status')}</th><th className="th">{at('Slip')}</th><th className="th text-right">{at('Actions')}</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="transition hover:bg-white/[0.025]">
                        <td className="td font-mono text-accent">{r.period}</td>
                        <td className="td">{r.employee_name}</td>
                        <td className="td">{r.department ? <Badge>{r.department}</Badge> : '—'}</td>
                        <td className="td font-mono">{money(r.gross_pay, ccy)}</td>
                        <td className="td font-mono text-bad">{money(r.deductions, ccy)}</td>
                        <td className="td font-mono font-semibold text-ok">{money(r.net_pay, ccy)}</td>
                        <td className="td"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                        <td className="td">{r.payslip_sent ? <Badge tone="ok">{at('sent')}</Badge> : <Badge tone="mute">{at('not sent')}</Badge>}</td>
                        <td className="td text-right">
                          <div className="inline-flex gap-1">
                            {canWrite && <button onClick={() => sendBatch(r.id)} disabled={sending} className="rounded-md p-1.5 text-ice-faint hover:bg-accent/10 hover:text-accent" title="Send this payslip"><Send size={14} /></button>}
                            {canWrite && <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><Pencil size={14} /></button>}
                            {canWrite && <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><Trash2 size={14} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {sub === 'overtime' && <OvertimeLog ccy={ccy} employees={employees} deptOptions={deptOptions} canWrite={canWrite} />}
      {sub === 'tax' && <TaxSettings ccy={ccy} taxConfig={taxConfig} onSaved={loadTax} />}

      {sub === 'status' && (
        <div className="panel overflow-hidden">
          {statusLoading ? <div className="p-6 text-center text-ice-faint">{at('Loading…')}</div>
          : status.length === 0 ? <EmptyState title="No payroll history" hint="Once you save payslips, each employee's latest month appears here." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-white/[0.02]"><tr>
                  <th className="th">{at('Employee')}</th><th className="th">{at('Department')}</th><th className="th">{at('Last period')}</th>
                  <th className="th">{at('Last net')}</th><th className="th">{at('Status')}</th><th className="th">{at('Payslip')}</th>
                </tr></thead>
                <tbody>
                  {status.map((r, i) => (
                    <tr key={i} className="transition hover:bg-white/[0.025]">
                      <td className="td">{r.employee_name}</td>
                      <td className="td">{r.department ? <Badge>{r.department}</Badge> : '—'}</td>
                      <td className="td font-mono text-accent">{r.last_period}</td>
                      <td className="td font-mono">{money(r.last_net, ccy)}</td>
                      <td className="td"><Badge tone={statusTone(r.last_status)}>{r.last_status}</Badge></td>
                      <td className="td">{r.payslip_sent ? <Badge tone="ok">sent {r.sent_at ? date(r.sent_at) : ''}</Badge> : <Badge tone="warn">{at('pending')}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Entry drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(null)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">{drawer === 'new' ? 'New Payslip' : 'Edit Payslip'}</h2>
              <button onClick={() => setDrawer(null)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Period (YYYY-MM) *"><input className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-07" /><span className="mt-1 block text-[11px] text-ice-faint">Business month {currentBusinessMonthLabel()} = {businessMonthKey(new Date())}</span></Field>
                <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={PAY_STATUS.map((s) => ({ value: s, label: s }))} /></Field>
              </div>
              <Field label="Employee *"><Select value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}
                options={[{ value: '', label: at('Select employee…') }, ...employees.map((e) => ({ value: e.id, label: e.full_name }))]} /></Field>
              {canWrite && form.employee_id && (
                <button onClick={generateFromAttendance} disabled={generating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/25">
                  <RefreshCw size={13} className={generating ? 'animate-spin' : ''} /> {generating ? at('Computing…') : at('Generate basic from attendance')}
                </button>
              )}
              {!form.employee_id && <Field label="…or type a name"><input className="input" value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} /></Field>}

              {/* Header / shift info */}
              <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                <div className="eyebrow mb-2">{at('Employee & shift info')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Job title"><input className="input" value={form.job_title || ''} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></Field>
                  <Field label="Badge no."><input className="input" value={form.badge_no || ''} onChange={(e) => setForm({ ...form, badge_no: e.target.value })} /></Field>
                  <Field label="Department"><Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
                  <Field label="Email (payslip)"><input className="input" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                  <Field label="Bank"><input className="input" value={form.bank_name || ''} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Field>
                  <Field label="Social Security No."><input className="input" value={form.social_security_no || ''} onChange={(e) => setForm({ ...form, social_security_no: e.target.value })} /></Field>
                  <Field label="No. of shifts"><input className="input" type="number" value={form.no_of_shifts} onChange={(e) => setForm({ ...form, no_of_shifts: e.target.value })} /></Field>
                  <Field label="Off days"><input className="input" type="number" value={form.off_days} onChange={(e) => setForm({ ...form, off_days: e.target.value })} /></Field>
                  <Field label="Leave days"><input className="input" type="number" value={form.leave_days} onChange={(e) => setForm({ ...form, leave_days: e.target.value })} /></Field>
                  <Field label="Attendance %"><input className="input" type="number" value={form.attendance_pct} onChange={(e) => setForm({ ...form, attendance_pct: e.target.value })} /></Field>
                </div>
              </div>

              {/* Earnings */}
              <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                <div className="eyebrow mb-2">{at('Earnings')}</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Basic salary"><input className="input" type="number" value={form.basic_pay} onChange={(e) => setForm({ ...form, basic_pay: e.target.value })} /></Field>
                  <Field label="Salary difference"><input className="input" type="number" value={form.salary_difference} onChange={(e) => setForm({ ...form, salary_difference: e.target.value })} /></Field>
                  <Field label="Mobile phone credit"><input className="input" type="number" value={form.mobile_credit} onChange={(e) => setForm({ ...form, mobile_credit: e.target.value })} /></Field>
                  <Field label="Transport allowance"><input className="input" type="number" value={form.transport_allowance} onChange={(e) => setForm({ ...form, transport_allowance: e.target.value })} /></Field>
                  <Field label="Canteen allowance"><input className="input" type="number" value={form.canteen_allowance} onChange={(e) => setForm({ ...form, canteen_allowance: e.target.value })} /></Field>
                  <Field label="Extra duty / acting"><input className="input" type="number" value={form.extra_duty_allowance} onChange={(e) => setForm({ ...form, extra_duty_allowance: e.target.value })} /></Field>
                  <Field label="Medical allowance"><input className="input" type="number" value={form.medical_allowance} onChange={(e) => setForm({ ...form, medical_allowance: e.target.value })} /></Field>
                  <Field label="Fuel allowance"><input className="input" type="number" value={form.fuel_allowance} onChange={(e) => setForm({ ...form, fuel_allowance: e.target.value })} /></Field>
                  <Field label="Other allowances"><input className="input" type="number" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} /></Field>
                  {Array.isArray(form.allowance_breakdown) && form.allowance_breakdown.length > 0 && (
                    <div className="sm:col-span-2 rounded-lg bg-white/[0.03] p-2 text-[11px] text-ice-dim">
                      <span className="text-ice-faint">{at('From pay setup')}: </span>
                      {form.allowance_breakdown.map((a, i) => (
                        <span key={i}>{i > 0 ? ' · ' : ''}{a.label || at('Allowance')} {money(Number(a.amount || 0), ccy)}</span>
                      ))}
                    </div>
                  )}
                  <Field label="Bonus"><input className="input" type="number" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} /></Field>
                  <Field label="12-hr shift overtime"><input className="input" type="number" value={form.shift_overtime} onChange={(e) => setForm({ ...form, shift_overtime: e.target.value })} /></Field>
                  <Field label="Weekday overtime"><input className="input" type="number" value={form.weekday_overtime} onChange={(e) => setForm({ ...form, weekday_overtime: e.target.value })} /></Field>
                  <Field label="Public holiday overtime"><input className="input" type="number" value={form.holiday_overtime} onChange={(e) => setForm({ ...form, holiday_overtime: e.target.value })} /></Field>
                  <Field label="Arrears overtime"><input className="input" type="number" value={form.arrears_overtime} onChange={(e) => setForm({ ...form, arrears_overtime: e.target.value })} /></Field>
                </div>
              </div>

              {/* Deductions with percentages */}
              <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="eyebrow">{at('Deductions')}</span>
                  {calc.autoCalc && <Badge tone="ok">{at('auto-calculated')}</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`SSNIT / SSF rate (%) → ${money(calc.ssnit, ccy)}`}><input className="input" type="number" step="0.1" value={form.ssnit_rate} onChange={(e) => setForm({ ...form, ssnit_rate: e.target.value })} disabled={calc.autoCalc} /></Field>
                  <Field label={`Union dues rate (%) → ${money(calc.union_dues, ccy)}`}><input className="input" type="number" step="0.1" value={form.union_dues_rate} onChange={(e) => setForm({ ...form, union_dues_rate: e.target.value })} disabled={calc.autoCalc} /></Field>
                  <Field label={`Income tax (PAYE)${calc.autoCalc ? ` → ${money(calc.tax.paye, ccy)}` : ''}`}>
                    <input className="input" type="number" value={form.paye_amount} placeholder={calc.autoCalc ? `auto ${calc.tax.paye}` : ''} onChange={(e) => setForm({ ...form, paye_amount: e.target.value })} />
                  </Field>
                  <Field label={`Overtime tax${calc.autoCalc ? ` → ${money(calc.tax.overtimeTax, ccy)}` : ''}`}>
                    <input className="input" type="number" value={form.overtime_tax} placeholder={calc.autoCalc ? `auto ${calc.tax.overtimeTax}` : ''} onChange={(e) => setForm({ ...form, overtime_tax: e.target.value })} />
                  </Field>
                  <Field label={`Bonus tax${calc.autoCalc ? ` → ${money(calc.tax.bonusTax, ccy)}` : ''}`}>
                    <input className="input" type="number" value={form.bonus_tax} placeholder={calc.autoCalc ? `auto ${calc.tax.bonusTax}` : ''} onChange={(e) => setForm({ ...form, bonus_tax: e.target.value })} />
                  </Field>
                  <Field label="Rent"><input className="input" type="number" value={form.rent_deduction} onChange={(e) => setForm({ ...form, rent_deduction: e.target.value })} /></Field>
                  <Field label="SSNIT loan"><input className="input" type="number" value={form.ssnit_loan} onChange={(e) => setForm({ ...form, ssnit_loan: e.target.value })} /></Field>
                  <Field label="Other deductions"><input className="input" type="number" value={form.other_deductions} onChange={(e) => setForm({ ...form, other_deductions: e.target.value })} /></Field>
                </div>
                {calc.autoCalc ? (
                  <div className="mt-2 space-y-1 text-[11px] text-ice-faint">
                    <p>SSNIT, union dues, PAYE, overtime tax, and bonus tax compute automatically from your Tax &amp; Deductions settings. Type a value to override any tax.</p>
                    <p>Chargeable income {money(calc.tax.chargeable, ccy)} · overtime {money(calc.tax.overtimeTotal, ccy)} ({money(calc.tax.overtimeWithin, ccy)} within threshold, {money(calc.tax.overtimeExcess, ccy)} excess) · bonus qualifying {money(calc.tax.bonusQualifying, ccy)}, excess {money(calc.tax.bonusExcess, ccy)} taxed at graduated rates.</p>
                  </div>
                ) : <p className="mt-2 text-[11px] text-ice-faint">SSNIT and union dues compute automatically from the basic salary × rate. Enable auto-calculation in Tax &amp; Deductions for PAYE.</p>}
              </div>

              {/* Totals */}
              <div className="rounded-lg border border-white/10 bg-navy/50 px-3 py-2.5 text-sm">
                <div className="flex justify-between"><span className="text-ice-faint">{at('Gross earnings')}</span><span className="font-mono text-ice">{money(calc.gross, ccy)}</span></div>
                <div className="flex justify-between"><span className="text-ice-faint">{at('Total deductions')}</span><span className="font-mono text-bad">−{money(calc.totalDed, ccy)}</span></div>
                <div className="mt-1 flex justify-between border-t border-white/10 pt-1"><span className="font-semibold text-ice">{at('Net pay')}</span><span className="font-mono font-bold text-ok">{money(calc.net, ccy)}</span></div>
                <div className="mt-2 flex justify-between border-t border-white/[0.06] pt-2 text-xs"><span className="text-ice-faint">Employer SSNIT ({form.ssnit_employer_rate}%)</span><span className="font-mono text-ice-dim">{money(calc.ssnit_employer, ccy)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-ice-faint">{at('Taxable income')}</span><span className="font-mono text-ice-dim">{money(calc.taxable, ccy)}</span></div>
              </div>

              <Field label="Notes"><textarea className="input min-h-[50px]" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(null)} className="btn-ghost">{at('Cancel')}</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save payslip'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
