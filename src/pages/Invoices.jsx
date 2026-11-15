import { useMemo, useState } from 'react'
import ExportCsvButton from '../components/ExportCsvButton'
import { Plus, X, Search, Filter, Send, Trash2, Pencil, FileText, Landmark, TrendingUp, Clock, Wallet, CheckCircle2, ExternalLink } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { StatCard, Badge, statusTone, Field, Select, useToast, EmptyState, PageHeader } from '../components/ui'
import FileUpload from '../components/FileUpload'
import { money, date } from '../lib/format'
import { at } from '../lib/tr'

const INV_STATUS = ['draft', 'sent', 'approved', 'partial', 'paid', 'overdue', 'cancelled']

export default function Invoices({ ccy }) {
  const { activeOrgId, role } = useAuth()
  const toast = useToast()
  const { rows, loading, insert, update, remove, refresh } = useTable('invoices')
  const [drawer, setDrawer] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const canWrite = role && role !== 'viewer'

  // Filters
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fSent, setFSent] = useState('')  // '' | sent | unsent

  const filtered = useMemo(() => rows.filter((r) => {
    if (fStatus && r.status !== fStatus) return false
    if (fSent === 'sent' && !r.sent) return false
    if (fSent === 'unsent' && r.sent) return false
    if (q.trim() && !['invoice_no', 'customer', 'reference'].some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase()))) return false
    return true
  }), [rows, q, fStatus, fSent])

  const empty = { invoice_no: `INV-${Date.now().toString().slice(-6)}`, customer: '', customer_email: '', cc_emails: '', status: 'draft', issue_date: new Date().toISOString().slice(0, 10), due_date: '', amount: '', tax: '', total: '', reference: '', document_url: '', notes: '' }
  const [form, setForm] = useState(empty)

  // auto total = amount + tax
  const autoTotal = (Number(form.amount || 0) + Number(form.tax || 0))

  const openNew = () => { setForm(empty); setDrawer('new') }
  const openEdit = (r) => { setForm({ ...empty, ...r, amount: r.amount ?? '', tax: r.tax ?? '', total: r.total ?? '' }); setDrawer(r.id) }

  const save = async () => {
    if (!form.invoice_no || !form.customer) { toast.error('Invoice no. and customer are required'); return }
    setSaving(true)
    try {
      const payload = {
        invoice_no: form.invoice_no, customer: form.customer, customer_email: form.customer_email,
        status: form.status, issue_date: form.issue_date || null, due_date: form.due_date || null, cc_emails: form.cc_emails,
        amount: Number(form.amount || 0), tax: Number(form.tax || 0),
        total: Number(form.total || autoTotal || 0),
        reference: form.reference, document_url: form.document_url, notes: form.notes,
      }
      if (drawer === 'new') await insert(payload); else await update(drawer, payload)
      toast.success('Invoice saved'); setDrawer(null)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const sendInvoice = async (inv) => {
    if (!inv.customer_email) { toast.error('Add a customer email first (edit the invoice)'); return }
    if (!window.confirm(`Email invoice ${inv.invoice_no} to ${inv.customer_email} for approval?`)) return
    setSending(true)
    try {
      const res = await fetch('/.netlify/functions/invoice-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: activeOrgId, invoice_id: inv.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      toast.success('Invoice emailed to customer')
      await refresh()
    } catch (e) { toast.error(e.message) } finally { setSending(false) }
  }

  const setStatus = async (inv, status) => {
    try {
      const patch = { status }
      if (status === 'approved') patch.approved_at = new Date().toISOString()
      await update(inv.id, patch)
      toast.success(`Marked ${status}`)
    } catch (e) { toast.error(e.message) }
  }

  const del = async (inv) => { if (!window.confirm(`Delete ${inv.invoice_no}?`)) return; try { await remove(inv.id); toast.success('Deleted') } catch (e) { toast.error(e.message) } }

  const outstanding = rows.filter((r) => ['sent', 'approved', 'partial', 'overdue'].includes(r.status)).reduce((s, r) => s + Number(r.total || 0), 0)
  const overdue = rows.filter((r) => r.status === 'overdue').length
  const collected = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.total || 0), 0)

  return (
    <>
      <PageHeader eyebrow="Finance" title="Invoices — Accounts Receivable" sub="Customer invoices, what is outstanding and what is overdue.">
        {canWrite && <button className="btn-primary" onClick={openNew}><Plus size={16} /> {at('New invoice')}</button>}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Total invoices" value={rows.length} icon={Landmark} />
        <StatCard label="Outstanding AR" value={money(outstanding, ccy)} tone={outstanding ? 'warn' : 'ok'} icon={TrendingUp} />
        <StatCard label="Overdue" value={overdue} tone={overdue ? 'bad' : 'ok'} icon={Clock} />
        <StatCard label="Collected" value={money(collected, ccy)} tone="ok" icon={Wallet} />
      </div>

      {/* Filters */}
      <div className="toolbar mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="searchbox">
            <Search size={15} className="text-ice-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, customer…" className="w-48 bg-transparent text-sm text-ice placeholder:text-ice-faint/70 outline-none" />
          </div>
          <Filter size={14} className="text-ice-faint" />
          <div className="w-36"><Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} options={[{ value: '', label: at('All statuses') }, ...INV_STATUS.map((s) => ({ value: s, label: s }))]} /></div>
          <div className="w-32"><Select value={fSent} onChange={(e) => setFSent(e.target.value)} options={[{ value: '', label: at('Sent & unsent') }, { value: 'sent', label: at('Sent only') }, { value: 'unsent', label: at('Unsent only') }]} /></div>
          <span className="ml-auto font-mono text-[11px] text-ice-faint">{filtered.length} of {rows.length}</span>
          <ExportCsvButton name="invoices" rows={filtered} columns={[['invoice_no', 'Invoice no.'], ['customer', 'Customer'], ['issue_date', 'Issue date'], ['due_date', 'Due date'], ['amount', 'Amount'], ['tax', 'Tax'], ['total', 'Total'], ['status', 'Status'], ['reference', 'Reference / PO']]} />
        </div>
      </div>

      <div className="panel overflow-hidden">
        {loading ? <div className="p-6 text-center text-ice-faint">{at('Loading…')}</div>
        : filtered.length === 0 ? <EmptyState title="No invoices" hint="Raise an invoice, attach the document, and email it to the customer for approval." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">{at('Invoice #')}</th><th className="th">{at('Customer')}</th><th className="th">{at('Due')}</th>
                <th className="th">{at('Total')}</th><th className="th">{at('Doc')}</th><th className="th">{at('Sent')}</th>
                <th className="th">{at('Status')}</th><th className="th text-right">{at('Actions')}</th>
              </tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-mono text-accent whitespace-nowrap">{r.invoice_no}</td>
                    <td className="td">{r.customer}<div className="text-[10px] text-ice-faint">{r.customer_email}</div></td>
                    <td className="td whitespace-nowrap">{date(r.due_date)}</td>
                    <td className="td font-mono font-semibold">{money(r.total, ccy)}</td>
                    <td className="td">{r.document_url ? <a href={r.document_url} target="_blank" rel="noreferrer" className="text-info hover:underline"><FileText size={14} className="inline" /></a> : <span className="text-ice-faint">—</span>}</td>
                    <td className="td">{r.sent ? <Badge tone="ok">{at('sent')}</Badge> : <Badge tone="mute">{at('no')}</Badge>}</td>
                    <td className="td">
                      {canWrite ? (
                        <select value={r.status} onChange={(e) => setStatus(r, e.target.value)}
                          className="rounded-md border border-white/10 bg-navy/60 px-2 py-1 text-xs text-ice outline-none">
                          {INV_STATUS.map((s) => <option key={s} value={s} className="bg-navy-700">{s}</option>)}
                        </select>
                      ) : <Badge tone={statusTone(r.status)}>{r.status}</Badge>}
                    </td>
                    <td className="td text-right">
                      <div className="inline-flex gap-1">
                        {canWrite && <button onClick={() => sendInvoice(r)} disabled={sending} className="rounded-md p-1.5 text-ice-faint hover:bg-accent/10 hover:text-accent" title="Email to customer"><Send size={14} /></button>}
                        {canWrite && <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><Pencil size={14} /></button>}
                        {canWrite && <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(null)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">{drawer === 'new' ? 'New Invoice' : 'Edit Invoice'}</h2>
              <button onClick={() => setDrawer(null)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Invoice no. *"><input className="input" value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></Field>
                <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={INV_STATUS.map((s) => ({ value: s, label: s }))} /></Field>
              </div>
              <Field label="Customer *"><input className="input" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></Field>
              <Field label="Customer email"><input className="input" type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} placeholder="accounts@customer.com" /></Field>
              <Field label="CC others (comma-separated)"><input className="input" value={form.cc_emails || ''} onChange={(e) => setForm({ ...form, cc_emails: e.target.value })} placeholder="cfo@company.com, records@company.com" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issue date"><input className="input" type="date" value={form.issue_date || ''} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></Field>
                <Field label="Due date"><input className="input" type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Amount"><input className="input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                <Field label="Tax"><input className="input" type="number" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} /></Field>
                <Field label="Total"><input className="input" type="number" value={form.total || autoTotal} onChange={(e) => setForm({ ...form, total: e.target.value })} /></Field>
              </div>
              <Field label="Reference / PO"><input className="input" value={form.reference || ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>

              <FileUpload label="Invoice document" bucket="invoice-files" accept=".pdf,.doc,.docx,image/*"
                value={form.document_url} onChange={(url) => setForm({ ...form, document_url: url })}
                entityId={drawer === 'new' ? form.invoice_no : drawer} field="invoice" />

              <Field label="Notes"><textarea className="input min-h-[60px]" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(null)} className="btn-ghost">{at('Cancel')}</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save invoice'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
