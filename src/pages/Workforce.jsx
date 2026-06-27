import { useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { date } from '../lib/format'
import { Users, UserCheck, UserMinus, Hammer, Building2, Network } from 'lucide-react'
import { useDepartments } from '../hooks/useDepartments'

const STATUS = ['active', 'leave', 'suspended', 'exited']
const WORKER = ['surface', 'underground', 'office', 'field']

function Tabs({ tab, setTab }) {
  const items = [['staff', 'Employees'], ['departments', 'Departments']]
  return (
    <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Workforce() {
  const [tab, setTab] = useState('staff')
  const { options: deptOptions } = useDepartments()

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />

      {tab === 'staff' ? (
        <ModuleScaffold
          eyebrow="People" title="Workforce" table="employees"
          newLabel="New employee" emptyTitle="No employees"
          emptyHint="Maintain your staff directory, departments, and employment status."
          searchKeys={['employee_no', 'full_name', 'department', 'position']}
          columns={[
            { key: 'employee_no', label: 'No.', render: (v) => <span className="font-mono text-accent">{v || '—'}</span> },
            { key: 'full_name', label: 'Name' },
            { key: 'department', label: 'Department', render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'position', label: 'Position' },
            { key: 'worker_type', label: 'Type', render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'status', label: 'Status', render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
            { key: 'hired_on', label: 'Hired', render: (v) => date(v) },
          ]}
          fields={[
            { key: 'full_name', label: 'Full name', required: true, span: true },
            { key: 'employee_no', label: 'Employee no.' },
            { key: 'department', label: 'Department', type: 'select', options: deptOptions },
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
      ) : (
        <ModuleScaffold
          eyebrow="People" title="Departments" table="departments"
          newLabel="New department" emptyTitle="No departments yet"
          emptyHint="Define your org structure here — these become the dropdown options across Workforce, Work Orders, Assets, and HSE."
          searchKeys={['name', 'code', 'head', 'cost_center']}
          columns={[
            { key: 'name', label: 'Department' },
            { key: 'code', label: 'Code', render: (v) => v ? <span className="font-mono text-accent">{v}</span> : '—' },
            { key: 'head', label: 'Head' },
            { key: 'cost_center', label: 'Cost centre', render: (v) => v ? <span className="font-mono">{v}</span> : '—' },
          ]}
          fields={[
            { key: 'name', label: 'Department name', required: true, span: true },
            { key: 'code', label: 'Code' },
            { key: 'head', label: 'Department head' },
            { key: 'cost_center', label: 'Cost centre' },
          ]}
          kpis={(rows) => {
            const withHead = rows.filter((r) => r.head).length
            const withCC = rows.filter((r) => r.cost_center).length
            return <>
              <StatCard label="Departments" value={rows.length} icon={Building2} />
              <StatCard label="With a head" value={withHead} icon={Network} />
              <StatCard label="With cost centre" value={withCC} icon={Network} />
              <StatCard label="Unassigned" value={rows.length - withHead} tone={rows.length - withHead ? 'warn' : 'ok'} icon={Network} />
            </>
          }}
        />
      )}
    </div>
  )
}
