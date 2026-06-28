import { useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { money, date } from '../lib/format'
import { useDepartments } from '../hooks/useDepartments'
import { UserCog, CalendarCheck, CalendarX, Wallet, Users } from 'lucide-react'

const LEAVE_TYPES  = ['annual', 'sick', 'maternity', 'paternity', 'study', 'compassionate', 'unpaid']
const LEAVE_STATUS = ['pending', 'approved', 'rejected', 'cancelled']
const PAY_STATUS   = ['draft', 'approved', 'paid']

function Tabs({ tab, setTab }) {
  const items = [['leave', 'Leave Requests'], ['payroll', 'Payroll']]
  return (
    <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition
            ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function HR() {
  const [tab, setTab] = useState('leave')
  const { options: deptOptions } = useDepartments()

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />

      {tab === 'leave' ? (
        <ModuleScaffold
          eyebrow="People" title="Leave Requests" table="leave_requests"
          newLabel="New request" emptyTitle="No leave requests"
          emptyHint="Log and track annual, sick, and other leave types for your workforce."
          searchKeys={['employee_name', 'department', 'leave_type', 'status']}
          columns={[
            { key: 'employee_name', label: 'Employee' },
            { key: 'department',    label: 'Department', render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'leave_type',    label: 'Type',       render: (v) => <Badge>{v}</Badge> },
            { key: 'start_date',    label: 'From',       render: (v) => date(v) },
            { key: 'end_date',      label: 'To',         render: (v) => date(v) },
            { key: 'days',          label: 'Days',       render: (v) => <span className="font-mono">{v}</span> },
            { key: 'status',        label: 'Status',     render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'employee_name', label: 'Employee name',  required: true },
            { key: 'department',    label: 'Department',     type: 'select', options: deptOptions },
            { key: 'leave_type',    label: 'Leave type',     type: 'select', options: LEAVE_TYPES.map((s) => ({ value: s, label: s })), default: 'annual' },
            { key: 'status',        label: 'Status',         type: 'select', options: LEAVE_STATUS.map((s) => ({ value: s, label: s })), default: 'pending' },
            { key: 'start_date',    label: 'Start date',     type: 'date',   required: true },
            { key: 'end_date',      label: 'End date',       type: 'date',   required: true },
            { key: 'days',          label: 'Days',           type: 'number', default: 1 },
            { key: 'reason',        label: 'Reason',         type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const pending  = rows.filter((r) => r.status === 'pending').length
            const approved = rows.filter((r) => r.status === 'approved').length
            const totalDays = rows.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days || 0), 0)
            const onLeave = rows.filter((r) => {
              const now = new Date()
              return r.status === 'approved' && new Date(r.start_date) <= now && new Date(r.end_date) >= now
            }).length
            return <>
              <StatCard label="Pending"        value={pending}   tone={pending ? 'warn' : 'ok'} icon={CalendarX} />
              <StatCard label="Approved"       value={approved}  tone="ok"   icon={CalendarCheck} />
              <StatCard label="Currently away" value={onLeave}   icon={Users} />
              <StatCard label="Days approved"  value={totalDays} icon={CalendarCheck} />
            </>
          }}
        />
      ) : (
        <ModuleScaffold
          eyebrow="People" title="Payroll" table="payroll"
          newLabel="New payroll entry" emptyTitle="No payroll records"
          emptyHint="Capture gross pay, allowances, deductions, and net pay per period."
          searchKeys={['employee_name', 'department', 'period', 'status']}
          columns={[
            { key: 'period',        label: 'Period',    render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'employee_name', label: 'Employee' },
            { key: 'department',    label: 'Dept',      render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'gross_pay',     label: 'Gross',     render: (v) => money(v) },
            { key: 'allowances',    label: 'Allow.',    render: (v) => money(v) },
            { key: 'deductions',    label: 'Deduct.',   render: (v) => money(v) },
            { key: 'net_pay',       label: 'Net pay',   render: (v) => <span className="font-semibold text-ok">{money(v)}</span> },
            { key: 'status',        label: 'Status',    render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'period',        label: 'Period (YYYY-MM)', required: true },
            { key: 'employee_name', label: 'Employee name',    required: true },
            { key: 'department',    label: 'Department',       type: 'select', options: deptOptions },
            { key: 'status',        label: 'Status',           type: 'select', options: PAY_STATUS.map((s) => ({ value: s, label: s })), default: 'draft' },
            { key: 'gross_pay',     label: 'Gross pay',        type: 'number', default: 0 },
            { key: 'allowances',    label: 'Allowances',       type: 'number', default: 0 },
            { key: 'deductions',    label: 'Deductions',       type: 'number', default: 0 },
            { key: 'net_pay',       label: 'Net pay',          type: 'number', default: 0 },
            { key: 'notes',         label: 'Notes',            type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const periods   = [...new Set(rows.map((r) => r.period))].length
            const approved  = rows.filter((r) => r.status === 'approved' || r.status === 'paid')
            const totalNet  = approved.reduce((s, r) => s + Number(r.net_pay || 0), 0)
            const totalGross = approved.reduce((s, r) => s + Number(r.gross_pay || 0), 0)
            return <>
              <StatCard label="Payroll entries" value={rows.length}     icon={Wallet} />
              <StatCard label="Periods"         value={periods}         icon={Wallet} />
              <StatCard label="Gross (approved)"value={money(totalGross)} icon={Wallet} />
              <StatCard label="Net (approved)"  value={money(totalNet)} tone="ok" icon={Wallet} />
            </>
          }}
        />
      )}
    </div>
  )
}
