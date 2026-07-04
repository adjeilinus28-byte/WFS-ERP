import { useEffect, useMemo, useState } from 'react'
import { Plus, X, Search, Filter, Send, Trash2, Pencil, FileText, Users, Wallet, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { StatCard, Badge, statusTone, Field, Select, useToast, EmptyState } from '../components/ui'
import { money, date, num } from '../lib/format'

const PAY_STATUS = ['draft', 'approved', 'paid']
const thisPeriod = () => new Date().toISOString().slice(0, 7)

function SubTabs({ tab, setTab }) {
  const items = [['slips', 'Payslips'], ['status', 'Status']]
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
const calcGrossNet = (f) => {
  const gross = ['basic_pay', 'overtime', 'bonus', 'allowances'].reduce((s, k) => s + Number(f[k] || 0), 0)
  const ded = ['tax', 'ssnit', 'other_deductions'].reduce((s, k) => s + Number(f[k] || 0), 0)
  return { gross, ded, net: gross - ded }
}

export default function Payroll({ ccy }) {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove, refresh } = useTable('payroll', { order: { column: 'period', ascending: false } })
  const { rows: employees } = useTable('employees')
  const [sub, setSub] = useState('slips')
  const [drawer, setDrawer] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const canWrite = role && role !== 'viewer'

  // Filters
  const [q, setQ] = useState('')
  const [fPeriod, setFPeriod] = useState(thisPeriod())
  const [fDept, setFDept] = useState('')

  const periods = useMemo(() => [...new Set(rows.map((r) => r.period))].sort().reverse(), [rows])

  const filtered = useMemo(() => rows.filter((r) => {
    if (fPeriod && r.period !== fPeriod) return false
    if (fDept && r.department !== fDept) return false
    if (q.trim() && !String(r.employee_name || '').toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [rows, q, fPeriod, fDept])

  // ── Entry drawer ──
  const emptyForm = { period: thisPeriod(), employee_id: '', employee_name: '', department: '', email: '',
    basic_pay: '', overtime: '', bonus: '', allowances: '', tax: '', ssnit: '', other_deductions: '', status: 'draft', notes: '' }
  const [form, setForm] = useState(emptyForm)
  const { gross, ded, net } = calcGrossNet(form)

  const openNew = () => { setForm(emptyForm); setDrawer('new') }
  const openEdit = (r) => { setForm({ ...emptyForm, ...r, basic_pay: r.basic_pay ?? '', overtime: r.overtime ?? '', bonus: r.bonus ?? '', allowances: r.allowances ?? '', tax: r.tax ?? '', ssnit: r.ssnit ?? '', other_deductions: r.other_deductions ?? '' }); setDrawer(r.id) }

  const pickEmployee = (id) => {
    const e = employees.find((x) => x.id === id)
    setForm((f) => ({ ...f, employee_id: id, employee_name: e?.full_name || f.employee_name, department: e?.department || f.department, email: e?.email || f.email }))
  }

  const save = async () => {
    if (!form.period || !form.employee_name) { toast.error('Period and employee are required'); return }
    setSaving(true)
    try {
      const payload = {
        period: form.period, employee_id: form.employee_id || null, employee_name: form.employee_name,
        department: form.department, email: form.email,
        basic_pay: Number(form.basic_pay || 0), overtime: Number(form.overtime || 0), bonus: Number(form.bonus || 0),
        allowances: Number(form.allowances || 0), tax: Number(form.tax || 0), ssnit: Number(form.ssnit || 0),
        other_deductions: Number(form.other_deductions || 0),
        gross_pay: gross, deductions: ded, net_pay: net, status: form.status, notes: form.notes,
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
                options={[{ value: '', label: 'All periods' }, ...(periods.includes(thisPeriod()) ? periods : [thisPeriod(), ...periods]).map((p) => ({ value: p, label: p }))]} /></div>
              <div className="w-40"><Select value={fDept} onChange={(e) => setFDept(e.target.value)} options={[{ value: '', label: 'All departments' }, ...deptOptions]} /></div>
              <span className="font-mono text-[11px] text-ice-faint">{filtered.length}</span>
              <div className="ml-auto flex gap-2">
                {canWrite && <button onClick={() => sendBatch('all')} disabled={sending || filtered.length === 0} className="btn-ghost btn-sm"><Send size={13} /> {sending ? 'Sending…' : 'Generate & send all'}</button>}
                {canWrite && <button onClick={openNew} className="btn-primary btn-sm"><Plus size={14} /> New slip</button>}
              </div>
            </div>
          </div>

          <div className="panel overflow-hidden">
            {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
            : filtered.length === 0 ? <EmptyState title="No payslips for this filter" hint="Add a slip or change the period/department filter." />
            : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-white/[0.02]"><tr>
                    <th className="th">Period</th><th className="th">Employee</th><th className="th">Dept</th>
                    <th className="th">Gross</th><th className="th">Deductions</th><th className="th">Net</th>
                    <th className="th">Status</th><th className="th">Slip</th><th className="th text-right">Actions</th>
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
                        <td className="td">{r.payslip_sent ? <Badge tone="ok">sent</Badge> : <Badge tone="mute">not sent</Badge>}</td>
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

      {sub === 'status' && (
        <div className="panel overflow-hidden">
          {statusLoading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
          : status.length === 0 ? <EmptyState title="No payroll history" hint="Once you save payslips, each employee's latest month appears here." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-white/[0.02]"><tr>
                  <th className="th">Employee</th><th className="th">Department</th><th className="th">Last period</th>
                  <th className="th">Last net</th><th className="th">Status</th><th className="th">Payslip</th>
                </tr></thead>
                <tbody>
                  {status.map((r, i) => (
                    <tr key={i} className="transition hover:bg-white/[0.025]">
                      <td className="td">{r.employee_name}</td>
                      <td className="td">{r.department ? <Badge>{r.department}</Badge> : '—'}</td>
                      <td className="td font-mono text-accent">{r.last_period}</td>
                      <td className="td font-mono">{money(r.last_net, ccy)}</td>
                      <td className="td"><Badge tone={statusTone(r.last_status)}>{r.last_status}</Badge></td>
                      <td className="td">{r.payslip_sent ? <Badge tone="ok">sent {r.sent_at ? date(r.sent_at) : ''}</Badge> : <Badge tone="warn">pending</Badge>}</td>
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
                <Field label="Period (YYYY-MM) *"><input className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-07" /></Field>
                <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={PAY_STATUS.map((s) => ({ value: s, label: s }))} /></Field>
              </div>
              <Field label="Employee *"><Select value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}
                options={[{ value: '', label: 'Select employee…' }, ...employees.map((e) => ({ value: e.id, label: e.full_name }))]} /></Field>
              {!form.employee_id && <Field label="…or type a name"><input className="input" value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} /></Field>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Department"><Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
                <Field label="Email (payslip)"><input className="input" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              </div>

              <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                <div className="eyebrow mb-2">Earnings</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Basic pay"><input className="input" type="number" value={form.basic_pay} onChange={(e) => setForm({ ...form, basic_pay: e.target.value })} /></Field>
                  <Field label="Overtime"><input className="input" type="number" value={form.overtime} onChange={(e) => setForm({ ...form, overtime: e.target.value })} /></Field>
                  <Field label="Bonus"><input className="input" type="number" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} /></Field>
                  <Field label="Allowances"><input className="input" type="number" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} /></Field>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                <div className="eyebrow mb-2">Deductions</div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="PAYE / Tax"><input className="input" type="number" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} /></Field>
                  <Field label="SSNIT"><input className="input" type="number" value={form.ssnit} onChange={(e) => setForm({ ...form, ssnit: e.target.value })} /></Field>
                  <Field label="Other"><input className="input" type="number" value={form.other_deductions} onChange={(e) => setForm({ ...form, other_deductions: e.target.value })} /></Field>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-navy/50 px-3 py-2.5 text-sm">
                <div className="flex justify-between"><span className="text-ice-faint">Gross</span><span className="font-mono text-ice">{money(gross, ccy)}</span></div>
                <div className="flex justify-between"><span className="text-ice-faint">Deductions</span><span className="font-mono text-bad">−{money(ded, ccy)}</span></div>
                <div className="mt-1 flex justify-between border-t border-white/10 pt-1"><span className="font-semibold text-ice">Net pay</span><span className="font-mono font-bold text-ok">{money(net, ccy)}</span></div>
              </div>

              <Field label="Notes"><textarea className="input min-h-[50px]" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(null)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save payslip'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
