import { useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard } from '../components/ui'
import { money, date } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import { Landmark, TrendingUp, TrendingDown, Clock, Wallet } from 'lucide-react'

const INV_STATUS  = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled']
const BILL_STATUS = ['draft', 'received', 'partial', 'paid', 'overdue', 'cancelled']
const PAY_METHOD  = ['bank_transfer', 'cash', 'cheque', 'mobile_money', 'card']
const PAY_STATUS  = ['draft', 'approved', 'paid']

function Tabs({ tab, setTab }) {
  const items = [['invoices', 'Invoices (AR)'], ['bills', 'Bills (AP)'], ['payments', 'Payments'], ['payroll', 'Payroll']]
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

      {tab === 'invoices' && (
        <ModuleScaffold
          eyebrow="Finance" title="Invoices — Accounts Receivable" table="invoices"
          newLabel="New invoice" emptyTitle="No invoices"
          emptyHint="Raise invoices to customers and track outstanding receivables."
          searchKeys={['invoice_no', 'customer', 'status']}
          columns={[
            { key: 'invoice_no', label: 'Invoice #', render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'customer',   label: 'Customer' },
            { key: 'issue_date', label: 'Issued',   render: (v) => date(v) },
            { key: 'due_date',   label: 'Due',      render: (v) => date(v) },
            { key: 'amount',     label: 'Amount',   render: (v) => money(v, ccy) },
            { key: 'tax',        label: 'Tax',      render: (v) => money(v, ccy) },
            { key: 'total',      label: 'Total',    render: (v) => <span className="font-semibold">{money(v, ccy)}</span> },
            { key: 'status',     label: 'Status',   render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'invoice_no', label: 'Invoice number', required: true },
            { key: 'customer',   label: 'Customer',       required: true, span: true },
            { key: 'status',     label: 'Status',         type: 'select', options: INV_STATUS.map((s) => ({ value: s, label: s })), default: 'draft' },
            { key: 'issue_date', label: 'Issue date',     type: 'date' },
            { key: 'due_date',   label: 'Due date',       type: 'date' },
            { key: 'amount',     label: 'Amount (ex tax)', type: 'number', default: 0 },
            { key: 'tax',        label: 'Tax',            type: 'number', default: 0 },
            { key: 'total',      label: 'Total',          type: 'number', default: 0 },
            { key: 'notes',      label: 'Notes',          type: 'textarea', span: true },
          ]}
          kpis={(rows) => {
            const outstanding = rows.filter((r) => ['sent','partial','overdue'].includes(r.status))
            const totalAR  = outstanding.reduce((s, r) => s + Number(r.total || 0), 0)
            const overdue  = rows.filter((r) => r.status === 'overdue').length
            const paid     = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.total || 0), 0)
            return <>
              <StatCard label="Total invoices" value={rows.length}       icon={Landmark} />
              <StatCard label="Outstanding AR" value={money(totalAR, ccy)} tone={totalAR ? 'warn' : 'ok'} icon={TrendingUp} />
              <StatCard label="Overdue"        value={overdue}           tone={overdue ? 'bad' : 'ok'} icon={Clock} />
              <StatCard label="Collected"      value={money(paid, ccy)}  tone="ok" icon={Wallet} />
            </>
          }}
        />
      )}

      {tab === 'bills' && (
        <ModuleScaffold
          eyebrow="Finance" title="Bills — Accounts Payable" table="bills"
          newLabel="New bill" emptyTitle="No bills"
          emptyHint="Record supplier bills and manage your payables."
          searchKeys={['bill_no', 'supplier', 'status']}
          columns={[
            { key: 'bill_no',    label: 'Bill #',   render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'supplier',   label: 'Supplier' },
            { key: 'issue_date', label: 'Issued',   render: (v) => date(v) },
            { key: 'due_date',   label: 'Due',      render: (v) => date(v) },
            { key: 'amount',     label: 'Amount',   render: (v) => money(v, ccy) },
            { key: 'tax',        label: 'Tax',      render: (v) => money(v, ccy) },
            { key: 'total',      label: 'Total',    render: (v) => <span className="font-semibold">{money(v, ccy)}</span> },
            { key: 'status',     label: 'Status',   render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
          ]}
          fields={[
            { key: 'bill_no',    label: 'Bill number',     required: true },
            { key: 'supplier',   label: 'Supplier',        required: true, span: true },
            { key: 'status',     label: 'Status',          type: 'select', options: BILL_STATUS.map((s) => ({ value: s, label: s })), default: 'received' },
            { key: 'issue_date', label: 'Issue date',      type: 'date' },
            { key: 'due_date',   label: 'Due date',        type: 'date' },
            { key: 'amount',     label: 'Amount (ex tax)', type: 'number', default: 0 },
            { key: 'tax',        label: 'Tax',             type: 'number', default: 0 },
            { key: 'total',      label: 'Total',           type: 'number', default: 0 },
            { key: 'notes',      label: 'Notes',           type: 'textarea', span: true },
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
          searchKeys={['reference', 'notes']}
          columns={[
            { key: 'paid_on',   label: 'Date',      render: (v) => date(v) },
            { key: 'amount',    label: 'Amount',    render: (v) => <span className="font-semibold text-ok">{money(v, ccy)}</span> },
            { key: 'method',    label: 'Method',    render: (v) => v ? <Badge>{v.replace('_', ' ')}</Badge> : '—' },
            { key: 'reference', label: 'Reference', render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
            { key: 'notes',     label: 'Notes' },
          ]}
          fields={[
            { key: 'amount',    label: 'Amount',              type: 'number', required: true, default: 0 },
            { key: 'paid_on',   label: 'Payment date',        type: 'date' },
            { key: 'method',    label: 'Method',              type: 'select', options: PAY_METHOD.map((s) => ({ value: s, label: s.replace('_', ' ') })), default: 'bank_transfer' },
            { key: 'reference', label: 'Reference / cheque no.' },
            { key: 'notes',     label: 'Notes',               type: 'textarea', span: true },
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

      {tab === 'payroll' && (
        <ModuleScaffold
          eyebrow="Finance" title="Payroll" table="payroll"
          newLabel="New payroll entry" emptyTitle="No payroll records"
          emptyHint="Capture gross pay, allowances, deductions, and net pay per period."
          searchKeys={['employee_name', 'department', 'period', 'status']}
          columns={[
            { key: 'period',        label: 'Period',   render: (v) => <span className="font-mono text-accent">{v}</span> },
            { key: 'employee_name', label: 'Employee' },
            { key: 'department',    label: 'Dept',     render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'gross_pay',     label: 'Gross',    render: (v) => money(v, ccy) },
            { key: 'allowances',    label: 'Allow.',   render: (v) => money(v, ccy) },
            { key: 'deductions',    label: 'Deduct.',  render: (v) => money(v, ccy) },
            { key: 'net_pay',       label: 'Net pay',  render: (v) => <span className="font-semibold text-ok">{money(v, ccy)}</span> },
            { key: 'status',        label: 'Status',   render: (v) => <Badge tone={statusTone(v)}>{v}</Badge> },
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
            const periods    = [...new Set(rows.map((r) => r.period))].length
            const approved   = rows.filter((r) => ['approved','paid'].includes(r.status))
            const totalGross = approved.reduce((s, r) => s + Number(r.gross_pay || 0), 0)
            const totalNet   = approved.reduce((s, r) => s + Number(r.net_pay   || 0), 0)
            return <>
              <StatCard label="Payroll entries"  value={rows.length}          icon={Wallet} />
              <StatCard label="Pay periods"      value={periods}              icon={Wallet} />
              <StatCard label="Gross (approved)" value={money(totalGross, ccy)} icon={TrendingUp} />
              <StatCard label="Net (approved)"   value={money(totalNet, ccy)} tone="ok" icon={Wallet} />
            </>
          }}
        />
      )}
    </div>
  )
}
