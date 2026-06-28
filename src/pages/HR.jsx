import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { date } from '../lib/format'
import { useDepartments } from '../hooks/useDepartments'
import { CalendarCheck, CalendarX, Users } from 'lucide-react'

const LEAVE_TYPES  = ['annual', 'sick', 'maternity', 'paternity', 'study', 'compassionate', 'unpaid']
const LEAVE_STATUS = ['pending', 'approved', 'rejected', 'cancelled']

export default function HR() {
  const { options: deptOptions } = useDepartments()

  return (
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
        const pending   = rows.filter((r) => r.status === 'pending').length
        const approved  = rows.filter((r) => r.status === 'approved').length
        const totalDays = rows.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days || 0), 0)
        const onLeave   = rows.filter((r) => {
          const now = new Date()
          return r.status === 'approved' && new Date(r.start_date) <= now && new Date(r.end_date) >= now
        }).length
        return <>
          <StatCard label="Pending"        value={pending}   tone={pending ? 'warn' : 'ok'} icon={CalendarX} />
          <StatCard label="Approved"       value={approved}  tone="ok" icon={CalendarCheck} />
          <StatCard label="Currently away" value={onLeave}   icon={Users} />
          <StatCard label="Days approved"  value={totalDays} icon={CalendarCheck} />
        </>
      }}
    />
  )
}
