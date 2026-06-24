import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { date } from '../lib/format'
import { Users, UserCheck, UserMinus, Hammer }  from 'lucide-react'

const STATUS = ['active', 'leave', 'suspended', 'exited']
const WORKER = ['surface', 'underground', 'office', 'field']

export default function Workforce() {
  return (
    <ModuleScaffold
      eyebrow="People" title="Workforce" table="employees"
      newLabel="New employee" emptyTitle="No employees"
      emptyHint="Maintain your staff directory, departments, and employment status."
      searchKeys={['employee_no', 'full_name', 'department', 'position']}
      columns={[
        { key: 'employee_no', label: 'No.', render: (v) => <span className="font-mono text-accent">{v || '—'}</span> },
        { key: 'full_name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'position', label: 'Position' },
        { key: 'worker_type', label: 'Type', render: (v) => v ? <Badge>{v}</Badge> : '—' },
        { key: 'status', label: 'Status', render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
        { key: 'hired_on', label: 'Hired', render: (v) => date(v) },
      ]}
      fields={[
        { key: 'full_name', label: 'Full name', required: true, span: true },
        { key: 'employee_no', label: 'Employee no.' },
        { key: 'department', label: 'Department' },
        { key: 'position', label: 'Position' },
        { key: 'worker_type', label: 'Worker type', type: 'select', options: WORKER.map((s) => ({ value: s, label: s })) },
        { key: 'status', label: 'Status', type: 'select', options: STATUS.map((s) => ({ value: s, label: s })), default: 'active' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone' },
        { key: 'hired_on', label: 'Hired on', type: 'date' },
      ]}
      kpis={(rows) => {
        const active = rows.filter((r) => r.status === 'active').length
        const onLeave = rows.filter((r) => r.status === 'leave').length
        const field = rows.filter((r) => ['field', 'underground', 'surface'].includes(r.worker_type)).length
        return <>
          <StatCard label="Headcount" value={rows.length} icon={Users} />
          <StatCard label="Active" value={active} tone="ok" icon={UserCheck} />
          <StatCard label="On leave" value={onLeave} icon={UserMinus} />
          <StatCard label="Field / site" value={field} icon={Hammer} />
        </>
      }}
    />
  )
}
