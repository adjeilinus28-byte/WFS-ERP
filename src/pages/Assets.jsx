import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { money, date, daysUntil } from '../lib/format'
import { Wrench, AlertTriangle, Activity, CalendarClock } from 'lucide-react'
import { useDepartments } from '../hooks/useDepartments'
import { at } from '../lib/tr'

const STATUS = ['operational', 'maintenance', 'down', 'retired']
const CRIT = ['low', 'medium', 'high', 'critical']

export default function Assets() {
  const { options: deptOptions } = useDepartments()
  return (
    <ModuleScaffold
      eyebrow="Operations" title="Asset Register" table="assets"
      newLabel="New asset" emptyTitle="No assets registered"
      emptyHint="Add your equipment to track status, criticality, and service schedules."
      searchKeys={['asset_code', 'name', 'category', 'location']}
      columns={[
        { key: 'asset_code', label: at('Code'), render: (v) => <span className="font-mono text-accent">{v}</span> },
        { key: 'name', label: at('Asset') },
        { key: 'category', label: at('Category') },
        { key: 'location', label: at('Location') },
        { key: 'criticality', label: at('Criticality'), render: (v) => <Badge tone={v === 'critical' || v === 'high' ? 'bad' : 'mute'}>{v}</Badge> },
        { key: 'status', label: at('Status'), render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
        { key: 'next_service_date', label: at('Next service'), render: (v) => {
          const d = daysUntil(v)
          return <span className={d != null && d <= 7 ? 'text-warn' : ''}>{date(v)}</span>
        } },
      ]}
      fields={[
        { key: 'asset_code', label: at('Asset code'), required: true },
        { key: 'name', label: at('Name'), required: true },
        { key: 'category', label: at('Category') },
        { key: 'status', label: at('Status'), type: 'select', options: STATUS.map((s) => ({ value: s, label: s })), default: 'operational' },
        { key: 'criticality', label: at('Criticality'), type: 'select', options: CRIT.map((s) => ({ value: s, label: s })), default: 'medium' },
        { key: 'location', label: at('Location') },
        { key: 'department', label: at('Department'), type: 'select', options: deptOptions },
        { key: 'manufacturer', label: at('Manufacturer') },
        { key: 'model', label: at('Model') },
        { key: 'serial_no', label: at('Serial no.') },
        { key: 'commissioned_on', label: at('Commissioned'), type: 'date' },
        { key: 'purchase_cost', label: at('Purchase cost'), type: 'number' },
        { key: 'next_service_date', label: at('Next service'), type: 'date' },
        { key: 'meter_reading', label: at('Meter (hrs/km)'), type: 'number' },
        { key: 'notes', label: at('Notes'), type: 'textarea', span: true },
      ]}
      kpis={(rows) => {
        const down = rows.filter((r) => r.status === 'down').length
        const crit = rows.filter((r) => r.criticality === 'critical').length
        const dueSoon = rows.filter((r) => { const d = daysUntil(r.next_service_date); return d != null && d <= 7 }).length
        const value = rows.reduce((s, r) => s + Number(r.purchase_cost || 0), 0)
        return <>
          <StatCard label="Assets down" value={down} tone={down ? 'bad' : 'ok'} icon={AlertTriangle} sub={`${rows.length} total`} />
          <StatCard label="Critical" value={crit} icon={Activity} />
          <StatCard label="Service due ≤7d" value={dueSoon} tone={dueSoon ? 'bad' : 'ok'} icon={CalendarClock} />
          <StatCard label="Fleet value" value={money(value)} icon={Wrench} />
        </>
      }}
    />
  )
}
