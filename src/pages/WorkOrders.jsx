import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { date, daysUntil } from '../lib/format'
import { ClipboardList, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'

const TYPE = ['preventive', 'corrective', 'inspection']
const PRIORITY = ['low', 'medium', 'high', 'urgent']
const STATUS = ['open', 'in_progress', 'on_hold', 'done', 'cancelled']

export default function WorkOrders() {
  return (
    <ModuleScaffold
      eyebrow="Operations" title="Work Orders" table="work_orders"
      newLabel="New work order" emptyTitle="No work orders"
      emptyHint="Raise preventive, corrective, and inspection jobs against your assets."
      searchKeys={['wo_number', 'title', 'assigned_to', 'department']}
      columns={[
        { key: 'wo_number', label: 'WO #', render: (v) => <span className="font-mono text-accent">{v}</span> },
        { key: 'title', label: 'Title' },
        { key: 'wo_type', label: 'Type', render: (v) => <Badge>{v}</Badge> },
        { key: 'priority', label: 'Priority', render: (v) => <Badge tone={v === 'urgent' || v === 'high' ? 'bad' : 'mute'}>{v}</Badge> },
        { key: 'assigned_to', label: 'Assigned' },
        { key: 'due_date', label: 'Due', render: (v, r) => {
          const d = daysUntil(v)
          const overdue = d != null && d < 0 && r.status !== 'done'
          return <span className={overdue ? 'text-bad' : d != null && d <= 2 ? 'text-warn' : ''}>{date(v)}</span>
        } },
        { key: 'status', label: 'Status', render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
      ]}
      fields={[
        { key: 'wo_number', label: 'WO number', required: true },
        { key: 'title', label: 'Title', required: true, span: true },
        { key: 'wo_type', label: 'Type', type: 'select', options: TYPE.map((s) => ({ value: s, label: s })), default: 'corrective' },
        { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY.map((s) => ({ value: s, label: s })), default: 'medium' },
        { key: 'status', label: 'Status', type: 'select', options: STATUS.map((s) => ({ value: s, label: s })), default: 'open' },
        { key: 'assigned_to', label: 'Assigned to' },
        { key: 'department', label: 'Department' },
        { key: 'due_date', label: 'Due date', type: 'date' },
        { key: 'description', label: 'Description', type: 'textarea', span: true },
      ]}
      kpis={(rows) => {
        const open = rows.filter((r) => ['open', 'in_progress', 'on_hold'].includes(r.status)).length
        const overdue = rows.filter((r) => { const d = daysUntil(r.due_date); return d != null && d < 0 && r.status !== 'done' && r.status !== 'cancelled' }).length
        const urgent = rows.filter((r) => r.priority === 'urgent' && r.status !== 'done').length
        const done = rows.filter((r) => r.status === 'done').length
        return <>
          <StatCard label="Open" value={open} icon={ClipboardList} />
          <StatCard label="Overdue" value={overdue} tone={overdue ? 'bad' : 'ok'} icon={Clock} />
          <StatCard label="Urgent" value={urgent} tone={urgent ? 'bad' : 'ok'} icon={AlertTriangle} />
          <StatCard label="Completed" value={done} tone="ok" icon={CheckCircle2} />
        </>
      }}
    />
  )
}
