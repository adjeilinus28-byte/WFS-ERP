import { useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { money, date } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import Payroll from './Payroll'
import Invoices from './Invoices'
import { Landmark, TrendingUp, TrendingDown, Clock, Wallet } from 'lucide-react'
import { at } from '../lib/tr'

const INV_STATUS  = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled']
const BILL_STATUS = ['draft', 'received', 'partial', 'paid', 'overdue', 'cancelled']
const PAY_METHOD  = ['bank_transfer', 'cash', 'cheque', 'mobile_money', 'card']
const PAY_STATUS  = ['draft', 'approved', 'paid']

function Tabs({ tab, setTab }) {
  const items = [['invoices', at('Invoices (AR)')], ['bills', at('Bills (AP)')], ['payments', at('Payments')], ['payroll', at('Payroll')]]
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

export default function Accounts() {
  const [tab, setTab] = useState('invoices')
  const { activeOrg } = useAuth()
  const ccy = activeOrg?.currency || 'GHS'
  const { options: deptOptions } = useDepartments()

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />

      {tab === 'invoices' && <Invoices ccy={ccy} />}

      {tab === 'bills' && (
        <ModuleScaffold
          eyebrow="Finance" title="Bills — Accounts Payable" table="bills"
          newLabel="New bill" emptyTitle="No bills"
          emptyHint="Record supplier bills and manage your payables."
          searchKeys={['bill_no', 'supplier', 'status']}
          columns={[
            { key: 'bill_no',    label: at('Bill #'),   render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'supplier',   label: at('Supplier') },
            { key: 'issue_date', label: at('Issued'),   render: (v) => date(v) },
            { key: 'due_date',   label: at('Due'),      render: (v) => date(v) },
            { key: 'amount',     label: at('Amount'),   render: (v) => money(v, ccy) },
            { key: 'tax',        label: at('Tax'),      render: (v) => money(v, ccy) },
            { key: 'total',      label: at('Total'),    render: (v) => <span className="font-semibold">{money(v, ccy)}</span> },
            { key: 'status',     label: at('Status'),   render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'bill_no',    label: at('Bill number'),     required: true },
            { key: 'supplier',   label: at('Supplier'),        required: true, span: true },
            { key: 'status',     label: at('Status'),          type: 'select', options: BILL_STATUS.map((s) => ({ value: s, label: s })), default: 'received' },
            { key: 'issue_date', label: at('Issue date'),      type: 'date' },
            { key: 'due_date',   label: at('Due date'),        type: 'date' },
            { key: 'amount',     label: at('Amount (ex tax)'), type: 'number', default: 0 },
            { key: 'tax',        label: at('Tax'),             type: 'number', default: 0 },
            { key: 'total',      label: at('Total'),           type: 'number', default: 0 },
            { key: 'notes',      label: at('Notes'),           type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const outstanding = rows.filter((r) => ['received','partial','overdue'].includes(r.status))
            const totalAP = outstanding.reduce((s, r) => s + Number(r.total || 0), 0)
            const overdue = rows.filter((r) => r.status === 'overdue').length
            const paid    = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.total || 0), 0)
            return <>
              <StatCard label="Total bills"    value={rows.length}       icon={Landmark} />
              <StatCard label="Outstanding AP" value={money(totalAP, ccy)} tone={totalAP ? 'warn' : 'ok'} icon={TrendingDown} />
              <StatCard label="Overdue"        value={overdue}           tone={overdue ? 'bad' : 'ok'} icon={Clock} />
              <StatCard label="Paid out"       value={money(paid, ccy)}  icon={Wallet} />
            </>
          }}
        />
      )}

      {tab === 'payments' && (
        <ModuleScaffold
          eyebrow="Finance" title="Payments" table="payments"
          newLabel="New payment" emptyTitle="No payments recorded"
          emptyHint="Log all incoming and outgoing payments against invoices and bills."
          searchKeys={['reference', at('notes')]}
          columns={[
            { key: 'paid_on',   label: at('Date'),      render: (v) => date(v) },
            { key: 'amount',    label: at('Amount'),    render: (v) => <span className="font-semibold text-ok">{money(v, ccy)}</span> },
            { key: 'method',    label: at('Method'),    render: (v) => v ? <Badge>{v.replace('_', ' ')}</Badge> : '—' },
            { key: 'reference', label: at('Reference'), render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
            { key: 'notes',     label: at('Notes') },
          ]}
          fields={[
            { key: 'amount',    label: at('Amount'),              type: 'number', required: true, default: 0 },
            { key: 'paid_on',   label: at('Payment date'),        type: 'date' },
            { key: 'method',    label: at('Method'),              type: 'select', options: PAY_METHOD.map((s) => ({ value: s, label: s.replace('_', ' ') })), default: 'bank_transfer' },
            { key: 'reference', label: at('Reference / cheque no.') },
            { key: 'notes',     label: at('Notes'),               type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
            const today = rows.filter((r) => r.paid_on === new Date().toISOString().slice(0,10)).reduce((s,r) => s + Number(r.amount||0), 0)
            const month = rows.filter((r) => r.paid_on?.slice(0,7) === new Date().toISOString().slice(0,7)).reduce((s,r) => s + Number(r.amount||0), 0)
            return <>
              <StatCard label="Transactions" value={rows.length}       icon={Wallet} />
              <StatCard label="Today"        value={money(today, ccy)} icon={Wallet} />
              <StatCard label="This month"   value={money(month, ccy)} icon={TrendingUp} />
              <StatCard label="All time"     value={money(total, ccy)} tone="ok" icon={Landmark} />
            </>
          }}
        />
      )}

      {tab === 'payroll' && <Payroll ccy={ccy} />}
    </div>
  )
}
