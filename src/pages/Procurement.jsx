import { useEffect, useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { money, date } from '../lib/format'
import { useTable } from '../hooks/useTable'
import { ShoppingCart, Truck, FileClock, Wallet } from 'lucide-react'

const PO_STATUS = ['draft', 'sent', 'received', 'closed', 'cancelled']

function Tabs({ tab, setTab }) {
  const items = [['suppliers', 'Suppliers'], ['orders', 'Purchase Orders']]
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

export default function Procurement() {
  const [tab, setTab] = useState('orders')
  const { rows: suppliers } = useTable('suppliers')
  const [supplierOpts, setSupplierOpts] = useState([])
  useEffect(() => {
    setSupplierOpts(suppliers.map((s) => ({ value: s.id, label: s.name })))
  }, [suppliers])
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || '—'

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />

      {tab === 'suppliers' ? (
        <ModuleScaffold
          eyebrow="Supply Chain" title="Suppliers" table="suppliers"
          newLabel="New supplier" emptyTitle="No suppliers"
          emptyHint="Build your approved vendor list with contacts and categories."
          searchKeys={['name', 'contact_name', 'email', 'category']}
          columns={[
            { key: 'name', label: 'Supplier' },
            { key: 'category', label: 'Category', render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'contact_name', label: 'Contact' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
          ]}
          fields={[
            { key: 'name', label: 'Supplier name', required: true, span: true },
            { key: 'category', label: 'Category' },
            { key: 'contact_name', label: 'Contact name' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone' },
          ]}
        />
      ) : (
        <ModuleScaffold
          eyebrow="Supply Chain" title="Purchase Orders" table="purchase_orders"
          newLabel="New PO" emptyTitle="No purchase orders"
          emptyHint="Raise POs against suppliers and track receipt status."
          searchKeys={['po_number', 'notes']}
          columns={[
            { key: 'po_number', label: 'PO #', render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'supplier_id', label: 'Supplier', render: (v) => supplierName(v) },
            { key: 'total', label: 'Total', render: (v, r) => money(v, r.currency) },
            { key: 'expected_date', label: 'Expected', render: (v) => date(v) },
            { key: 'status', label: 'Status', render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'po_number', label: 'PO number', required: true },
            { key: 'supplier_id', label: 'Supplier', type: 'select', options: supplierOpts },
            { key: 'status', label: 'Status', type: 'select', options: PO_STATUS.map((s) => ({ value: s, label: s })), default: 'draft' },
            { key: 'total', label: 'Total amount', type: 'number', default: 0 },
            { key: 'currency', label: 'Currency', default: 'GHS' },
            { key: 'expected_date', label: 'Expected date', type: 'date' },
            { key: 'notes', label: 'Notes', type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const open = rows.filter((r) => ['draft', 'sent'].includes(r.status)).length
            const received = rows.filter((r) => r.status === 'received').length
            const committed = rows.filter((r) => ['draft', 'sent'].includes(r.status)).reduce((s, r) => s + Number(r.total || 0), 0)
            return <>
              <StatCard label="Total POs" value={rows.length} icon={ShoppingCart} />
              <StatCard label="Open" value={open} icon={FileClock} />
              <StatCard label="Received" value={received} tone="ok" icon={Truck} />
              <StatCard label="Committed spend" value={money(committed)} icon={Wallet} />
            </>
          }}
        />
      )}
    </div>
  )
}
