import { useEffect, useState } from 'react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard, Field, Select, useToast } from '../components/ui'
import { supabase } from '../lib/supabase'
import { at } from '../lib/tr'
import { money, date } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import Payroll from './Payroll'
import Invoices from './Invoices'
import BankCash from './BankCash'
import { Landmark, TrendingUp, TrendingDown, Clock, Wallet } from 'lucide-react'

const INV_STATUS  = ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled']
const BILL_STATUS = ['draft', 'received', 'partial', 'paid', 'overdue', 'cancelled']
const PAY_METHOD  = ['bank_transfer', 'cash', 'cheque', 'mobile_money', 'card']
const PAY_STATUS  = ['draft', 'approved', 'paid']

function Tabs({ tab, setTab }) {
  const items = [['invoices', 'Invoices (AR)'], ['bills', 'Bills (AP)'], ['payments', 'Payments'], ['bank', 'Bank & cash'], ['payroll', 'Payroll']]
  return (
    <div className="tabs mb-5">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)}
          className={`tab ${tab === k ? 'tab-on' : ''}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Accounts() {
  const [tab, setTab] = useState('invoices')
  const { activeOrg, activeOrgId } = useAuth()
  const ccy = activeOrg?.currency || 'GHS'
  const { options: deptOptions } = useDepartments()
  const [payBill, setPayBill] = useState(null)     // bill row being paid
  const [billsKey, setBillsKey] = useState(0)       // bump to force bills reload
  const [banks, setBanks] = useState([])
  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('bank_accounts').select('id, name, is_active').eq('org_id', activeOrgId).order('created_at')
      .then(({ data }) => setBanks(data || []))
  }, [activeOrgId, tab])
  const bankName = Object.fromEntries(banks.map((b) => [b.id, b.name]))

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />

      {tab === 'invoices' && <Invoices ccy={ccy} />}

      {tab === 'bills' && (
        <ModuleScaffold
          key={billsKey}
          eyebrow="Finance" title="Bills — Accounts Payable" sub="Supplier bills, due dates and what is still owed." table="bills"
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
            { key: 'id',         label: '',         render: (_v, r) => (
              ['paid', 'void', 'cancelled'].includes(r.status)
                ? null
                : <button onClick={(e) => { e.stopPropagation(); setPayBill(r) }}
                    className="rounded-md bg-ok/15 px-2 py-1 text-xs text-ok hover:bg-ok/25">{at('Pay')}</button>
            ) },
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
          eyebrow="Finance" title="Payments" sub="Money in and out — supplier payments, customer receipts and other bank transactions." table="payments"
          newLabel="New payment" emptyTitle="No payments recorded"
          emptyHint="Log all incoming and outgoing payments against invoices and bills."
          searchKeys={['reference', 'notes']}
          columns={[
            { key: 'paid_on',   label: 'Date',      render: (v) => date(v) },
            { key: 'direction', label: 'Type',      render: (v) => v === 'in' ? <Badge tone="ok">{at('Money in')}</Badge> : <Badge>{at('Money out')}</Badge> },
            { key: 'amount',    label: 'Amount',    render: (v, r) => <span className={`font-semibold ${r.direction === 'in' ? 'text-ok' : 'text-ice'}`}>{money(v, ccy)}</span> },
            { key: 'bank_account_id', label: 'Bank account', render: (v) => bankName[v] || <span className="text-ice-faint">{at('not linked')}</span> },
            { key: 'method',    label: 'Method',    render: (v) => v ? <Badge>{v.replace('_', ' ')}</Badge> : '—' },
            { key: 'reference', label: 'Reference', render: (v) => <span className="font-mono text-xs">{v || '—'}</span> },
            { key: 'notes',     label: 'Notes' },
          ]}
          fields={[
            { key: 'direction', label: 'Type',                type: 'select', options: [{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }], default: 'out' },
            { key: 'bank_account_id', label: 'Bank account',  type: 'select', options: banks.filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name })) },
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

      {tab === 'bank' && <BankCash />}

      {tab === 'payroll' && <Payroll ccy={ccy} />}

      {payBill && (
        <PayBillDialog
          bill={payBill} ccy={ccy} orgId={activeOrgId} banks={banks.filter((b) => b.is_active)}
          onClose={() => setPayBill(null)}
          onPaid={() => { setPayBill(null); setBillsKey((k) => k + 1) }}
        />
      )}
    </div>
  )
}

// ── Pay a bill: records an outbound payment linked to the bill. The DB trigger
// (0029) recomputes the bill's status → partial/paid from the payment total, so
// there's no manual status flip and no double-entry re-keying. ──────────────
function PayBillDialog({ bill, ccy, orgId, banks = [], onClose, onPaid }) {
  const toast = useToast()
  const outstanding = Number(bill.total || bill.amount || 0)
  const [amount, setAmount] = useState(outstanding)
  const [method, setMethod] = useState('bank')
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [bankId, setBankId] = useState(banks[0]?.id || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error(at('Enter a payment amount')); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('payments').insert({
        org_id: orgId, direction: 'out', method,
        amount: amt, paid_on: paidOn, reference: reference || null,
        bill_id: bill.id, bank_account_id: bankId || null,
        notes: `Payment for bill ${bill.bill_no || ''}`,
      })
      if (error) throw error
      toast.success(at('Payment recorded — bill updated'))
      onPaid()
    } catch (e) {
      toast.error(e.message || 'Could not record payment')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={at('Pay bill')}>
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-navy-800 p-6 shadow-pop">
        <h3 className="font-display text-lg font-bold text-ice">{at('Pay bill')} {bill.bill_no}</h3>
        <p className="mt-1 text-sm text-ice-faint">{bill.supplier || bill.supplier_name || ''} · {at('Outstanding')} {money(outstanding, ccy)}</p>
        <div className="mt-4 space-y-3">
          <Field label={at('Amount')}>
            <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={at('Method')}>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}
              options={[['bank','Bank'],['cash','Cash'],['momo','Mobile money'],['cheque','Cheque']].map(([v,l]) => ({ value: v, label: l }))} translateOptions />
          </Field>
          <Field label={at('Payment date')}>
            <input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          {banks.length > 0 && (
            <Field label={at('Paid from')}>
              <Select value={bankId} onChange={(e) => setBankId(e.target.value)}
                options={[...banks.map((b) => ({ value: b.id, label: b.name })), { value: '', label: 'Not linked to an account' }]} />
            </Field>
          )}
          <Field label={at('Reference / cheque no.')}>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">{at('Cancel')}</button>
          <button onClick={submit} disabled={busy} className="btn-primary">{busy ? at('Saving…') : at('Record payment')}</button>
        </div>
      </div>
    </div>
  )
}
