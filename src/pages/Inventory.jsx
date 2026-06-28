import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, StatCard } from '../components/ui'
import { money, num } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { Boxes, TrendingDown, PackageX, Layers } from 'lucide-react'

const lowStock = (r) => Number(r.qty_on_hand) <= Number(r.reorder_level)

export default function Inventory() {
  const { activeOrg } = useAuth()
  const ccy = activeOrg?.currency || 'GHS'
  return (
    <ModuleScaffold
      eyebrow="Supply Chain" title="Inventory" table="inventory_items"
      newLabel="New item" emptyTitle="No stock items"
      emptyHint="Track stock levels, reorder points, and store value across warehouses."
      searchKeys={['sku', 'name', 'category', 'location']}
      columns={[
        { key: 'sku', label: 'SKU', render: (v) => <span className="font-mono text-accent">{v}</span> },
        { key: 'name', label: 'Item' },
        { key: 'category', label: 'Category' },
        { key: 'qty_on_hand', label: 'On hand', render: (v, r) => (
          <span className={lowStock(r) ? 'text-bad' : ''}>{num(v)} {r.uom}</span>
        ) },
        { key: 'reorder_level', label: 'Reorder', render: (v) => num(v) },
        { key: 'unit_cost', label: 'Unit cost', render: (v) => money(v, ccy) },
        { key: 'location', label: 'Location' },
        { key: '_status', label: 'Status', render: (_, r) => lowStock(r)
          ? <Badge tone="bad">reorder</Badge> : <Badge tone="ok">ok</Badge> },
      ]}
      fields={[
        { key: 'sku', label: 'SKU', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'category', label: 'Category' },
        { key: 'uom', label: 'Unit (uom)', default: 'ea' },
        { key: 'qty_on_hand', label: 'Qty on hand', type: 'number', default: 0 },
        { key: 'reorder_level', label: 'Reorder level', type: 'number', default: 0 },
        { key: 'unit_cost', label: 'Unit cost', type: 'number', default: 0 },
        { key: 'location', label: 'Location' },
      ]}
      kpis={(rows) => {
        const low = rows.filter(lowStock).length
        const out = rows.filter((r) => Number(r.qty_on_hand) <= 0).length
        const value = rows.reduce((s, r) => s + Number(r.qty_on_hand || 0) * Number(r.unit_cost || 0), 0)
        return <>
          <StatCard label="SKUs" value={rows.length} icon={Boxes} />
          <StatCard label="Below reorder" value={low} tone={low ? 'bad' : 'ok'} icon={TrendingDown} />
          <StatCard label="Out of stock" value={out} tone={out ? 'bad' : 'ok'} icon={PackageX} />
          <StatCard label="Stock value" value={money(value, ccy)} icon={Layers} />
        </>
      }}
    />
  )
}
