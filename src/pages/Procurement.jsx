import { callFn } from '../lib/fn'
import { useEffect, useMemo, useState } from 'react'
import Suppliers from './Suppliers'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, statusTone, StatCard, PageHeader, Field, Select, useToast, EmptyState } from '../components/ui'
import { at } from '../lib/tr'
import { money, date } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../hooks/usePermissions'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { useApprovalRules } from '../components/ApprovalRules'
import {
  ShoppingCart, Truck, FileClock, Wallet, Plus, X, Check, Send, ArrowRight, FileText, Clock, Receipt } from 'lucide-react'

const PO_STATUS = ['draft', 'sent', 'received', 'closed', 'cancelled']
const PRIORITY = ['low', 'normal', 'high', 'urgent']

function Tabs({ tab, setTab }) {
  const items = [['requests', 'Purchase Requests'], ['orders', 'Purchase Orders'], ['suppliers', 'Suppliers']]
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

async function notify(payload) {
  try {
    await callFn('procurement-notify', payload)
  } catch (_) {}
}

// ── Requests tab ─────────────────────────────────────────────────────────────
function Requests({ suppliers }) {
  const { activeOrgId, activeOrg, role, user } = useAuth()
  const toast = useToast()
  const ccy = activeOrg?.currency || 'GHS'
  const { options: deptOptions } = useDepartments()
  const { rows, loading, insert, update, remove } = useTable('purchase_requests')
  const [drawer, setDrawer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [decide, setDecide] = useState(null)
  const [note, setNote] = useState('')
  const canApprove = ['owner', 'admin', 'manager', 'supervisor'].includes(role)
  const { rules } = useApprovalRules()
  // Own request while "Can't approve own" is on → no Review button (mirrors Approvals and the database guard).
  const selfBlocked = (r) => (rules.purchase_request?.block_self ?? true) && !!r.created_by && r.created_by === user?.id

  const [form, setForm] = useState({
    title: '', department: '', approver_email: '', approver_name: '',
    supplier_id: '', priority: 'normal', est_total: '', needed_by: '', justification: '', cc_emails: '',
  })

  const submit = async () => {
    if (!form.title || !form.approver_email) { toast.error('Title and approver email are required'); return }
    setSaving(true)
    try {
      const [created] = await insert({
        ...form, est_total: Number(form.est_total || 0), currency: ccy,
        // empty pickers are null, not '' (supplier_id is a uuid, needed_by a date)
        supplier_id: form.supplier_id || null, needed_by: form.needed_by || null,
        department: form.department || null, cc_emails: form.cc_emails.trim() || null,
        request_no: `PR-${Date.now().toString().slice(-6)}`,
        requested_by: user?.email, status: 'pending',
      })
      // Small requests can be approved automatically (Settings → Approval rules) by a
      // database trigger after the insert, so read the status back before telling the user.
      const { data: saved } = created?.id
        ? await supabase.from('purchase_requests').select('status').eq('id', created.id).maybeSingle()
        : { data: null }
      if (saved?.status === 'approved') {
        toast.success(at('Request approved automatically — it is under your auto-approve limit'))
      } else {
        if (created?.id) await notify({ org_id: activeOrgId, event: 'request_submitted', request_id: created.id })
        toast.success('Request submitted — approver notified')
      }
      setDrawer(false)
      setForm({ title: '', department: '', approver_email: '', approver_name: '', supplier_id: '', priority: 'normal', est_total: '', needed_by: '', justification: '', cc_emails: '' })
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const decideNow = async (status) => {
    try {
      await update(decide.id, { status, decision_note: note, decided_by: user?.email, decided_at: new Date().toISOString() })
      await notify({ org_id: activeOrgId, event: status === 'approved' ? 'request_approved' : 'request_declined', request_id: decide.id })
      toast.success(`Request ${status}`)
      setDecide(null); setNote('')
    } catch (e) { toast.error(e.message) }
  }

  // Convert approved request → draft PO
  const convert = async (pr) => {
    if (!window.confirm(`Create a draft Purchase Order from "${pr.title}"?`)) return
    try {
      const { data: po, error } = await supabase.from('purchase_orders').insert({
        org_id: activeOrgId, po_number: `PO-${Date.now().toString().slice(-6)}`,
        supplier_id: pr.supplier_id, status: 'draft', currency: ccy,
        total: pr.est_total || 0, request_id: pr.id, supplier_status: 'pending',
        notes: `From request ${pr.request_no}: ${pr.title}`,
      }).select().single()
      if (error) throw error
      await update(pr.id, { status: 'converted', po_id: po.id })
      toast.success('Draft PO created — edit it in the Purchase Orders tab')
    } catch (e) { toast.error(e.message) }
  }

  const del = async (row) => {
    if (!window.confirm(`Delete request ${row.request_no}?`)) return
    try { await remove(row.id); toast.success('Deleted') } catch (e) { toast.error(e.message) }
  }

  const pending = rows.filter((r) => r.status === 'pending').length
  const approved = rows.filter((r) => r.status === 'approved').length

  return (
    <>
      <PageHeader eyebrow="Supply Chain" title="Purchase Requests" sub="Raise, approve and convert requests into purchase orders.">
        <button className="btn-primary" onClick={() => setDrawer(true)}><Plus size={16} /> New request</button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Pending" value={pending} tone={pending ? 'warn' : 'ok'} icon={FileClock} />
        <StatCard label="Approved" value={approved} tone="ok" icon={Check} />
        <StatCard label="Converted" value={rows.filter((r) => r.status === 'converted').length} icon={ArrowRight} />
        <StatCard label="Total requests" value={rows.length} icon={FileText} />
      </div>

      <div className="panel overflow-hidden">
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : rows.length === 0 ? <EmptyState title="No purchase requests" hint="Submit a request to route it to a department or operations head for approval." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">Ref</th><th className="th">Title</th><th className="th">Dept</th>
                <th className="th">Approver</th><th className="th">Est. total</th><th className="th">Priority</th>
                <th className="th">Status</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-mono text-accent whitespace-nowrap">{r.request_no}</td>
                    <td className="td">{r.title}</td>
                    <td className="td">{r.department ? <Badge>{r.department}</Badge> : '—'}</td>
                    <td className="td text-xs">{r.approver_name || r.approver_email}</td>
                    <td className="td font-mono">{money(r.est_total, ccy)}</td>
                    <td className="td"><Badge tone={r.priority === 'urgent' || r.priority === 'high' ? 'bad' : 'mute'}>{r.priority}</Badge></td>
                    <td className="td"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="td text-right">
                      <div className="inline-flex gap-1">
                        {canApprove && r.status === 'pending' && (selfBlocked(r) ? (
                          <span className="whitespace-nowrap rounded-md bg-white/[0.04] px-2 py-1 text-xs text-ice-faint" title={at('Your request — another approver must decide')}>{at('Your request')}</span>
                        ) : (
                          <button onClick={() => { setDecide(r); setNote('') }} className="rounded-md bg-ok/10 px-2 py-1 text-xs text-ok hover:bg-ok/20">Review</button>
                        ))}
                        {r.status === 'approved' && (
                          <button onClick={() => convert(r)} className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent hover:bg-accent/25">Convert to PO</button>
                        )}
                        <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><X size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New request drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">New Purchase Request</h2>
              <button onClick={() => setDrawer(false)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Title *"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What needs procuring" /></Field>
              <Field label="Department"><Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={[{ value: '', label: '—' }, ...deptOptions]} /></Field>
              <div className="rounded-lg border border-white/10 bg-navy/40 p-3">
                <div className="eyebrow mb-2">Route approval to</div>
                <div className="grid grid-cols-1 gap-3">
                  <Field label="Approver name (dept / ops head)"><input className="input" value={form.approver_name} onChange={(e) => setForm({ ...form, approver_name: e.target.value })} /></Field>
                  <Field label="Approver email *"><input className="input" type="email" value={form.approver_email} onChange={(e) => setForm({ ...form, approver_email: e.target.value })} placeholder="head@company.com" /></Field>
                </div>
              </div>
              <Field label="CC others (comma-separated)"><input className="input" value={form.cc_emails || ''} onChange={(e) => setForm({ ...form, cc_emails: e.target.value })} placeholder="finance@company.com, ops@company.com" /></Field>
              <Field label="Suggested supplier"><Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} options={[{ value: '', label: '—' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={PRIORITY.map((s) => ({ value: s, label: s }))} /></Field>
                <Field label={`Est. total (${ccy})`}><input className="input" type="number" value={form.est_total} onChange={(e) => setForm({ ...form, est_total: e.target.value })} /></Field>
              </div>
              <Field label="Needed by"><input className="input" type="date" value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} /></Field>
              <Field label="Justification"><textarea className="input min-h-[80px]" value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setDrawer(false)} className="btn-ghost">Cancel</button>
              <button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Decide modal */}
      {decide && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setDecide(null)} />
          <div className="panel relative w-full max-w-md p-5 animate-rise">
            <h3 className="font-display text-lg font-bold text-ice">Review request</h3>
            <p className="mt-1 text-sm text-ice-faint">{decide.title} · est. {money(decide.est_total, ccy)}</p>
            {decide.justification && <p className="mt-2 rounded bg-white/[0.03] px-3 py-2 text-sm text-ice/80">{decide.justification}</p>}
            <Field label="Decision note (optional)"><textarea className="input mt-2 min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDecide(null)} className="btn-ghost">Cancel</button>
              <button onClick={() => decideNow('declined')} className="btn bg-bad/15 text-bad hover:bg-bad/25"><X size={15} /> Decline</button>
              <button onClick={() => decideNow('approved')} className="btn-primary"><Check size={15} /> Approve</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Purchase Orders tab ──────────────────────────────────────────────────────
function PurchaseOrders({ suppliers }) {
  const { activeOrgId, activeOrg, role } = useAuth()
  const toast = useToast()
  const ccy = activeOrg?.currency || 'GHS'
  const { rows, loading, insert, update, remove } = useTable('purchase_orders')
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)
  const { can: _can_operations } = usePermissions()
  const canWrite = _can_operations('operations', 'edit')
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || '—'

  // Raise a payable from a PO accepted in person/phone. Idempotent server-side:
  // if the PO already has a bill, the RPC returns it rather than duplicating.
  const raiseBill = async (po) => {
    try {
      const { data, error } = await supabase.rpc('create_bill_from_po', { p_po: po.id })
      if (error) throw error
      await load()
      toast.success(po.bill_id ? at('Bill already exists — opened in Accounts → Bills') : at('Bill raised — see Accounts → Bills'))
    } catch (e) {
      toast.error(e.message || 'Could not raise bill')
    }
  }

  const send = async (po) => {
    const sup = suppliers.find((s) => s.id === po.supplier_id)
    if (!sup) { toast.error('Assign a supplier first'); return }
    if (!sup.email) { toast.error('Supplier has no email address'); return }
    if (!window.confirm(`Email PO ${po.po_number} to ${sup.name} for accept/decline?`)) return
    await notify({ org_id: activeOrgId, event: 'po_to_supplier', po_id: po.id })
    await update(po.id, { status: 'sent' })
    toast.success(`Sent to ${sup.name} — awaiting their response`)
  }

  const save = async () => {
    setSaving(true)
    try {
      const patch = { po_number: edit.po_number, supplier_id: edit.supplier_id || null, status: edit.status, total: Number(edit.total || 0), expected_date: edit.expected_date || null, notes: edit.notes, cc_emails: edit.cc_emails }
      if (edit.id) await update(edit.id, patch); else await insert(patch)
      toast.success('Saved'); setEdit(null)
    } catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }

  const del = async (po) => { if (!window.confirm(`Delete ${po.po_number}?`)) return; try { await remove(po.id); toast.success('Deleted') } catch (e) { toast.error(e.message) } }

  const supTone = (s) => s === 'accepted' ? 'ok' : s === 'declined' ? 'bad' : 'warn'

  return (
    <>
      <PageHeader eyebrow="Supply Chain" title="Purchase Orders" sub="Orders sent to suppliers and their responses.">
        {canWrite && <button className="btn-primary" onClick={() => setEdit({ po_number: `PO-${Date.now().toString().slice(-6)}`, status: 'draft', total: 0, currency: ccy })}><Plus size={16} /> New PO</button>}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Total POs" value={rows.length} icon={ShoppingCart} />
        <StatCard label="Awaiting supplier" value={rows.filter((r) => r.status === 'sent' && r.supplier_status === 'pending').length} tone="warn" icon={Clock} />
        <StatCard label="Accepted" value={rows.filter((r) => r.supplier_status === 'accepted').length} tone="ok" icon={Check} />
        <StatCard label="Committed" value={money(rows.filter((r) => ['draft', 'sent'].includes(r.status)).reduce((s, r) => s + Number(r.total || 0), 0), ccy)} icon={Wallet} />
      </div>

      <div className="panel overflow-hidden">
        {loading ? <div className="p-6 text-center text-ice-faint">Loading…</div>
        : rows.length === 0 ? <EmptyState title="No purchase orders" hint="Convert an approved request, or create a PO directly." />
        : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">PO #</th><th className="th">Supplier</th><th className="th">Total</th>
                <th className="th">Expected</th><th className="th">Status</th><th className="th">Supplier resp.</th>
                <th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-mono text-accent whitespace-nowrap">{r.po_number}</td>
                    <td className="td">{supplierName(r.supplier_id)}</td>
                    <td className="td font-mono">{money(r.total, ccy)}</td>
                    <td className="td whitespace-nowrap">{date(r.expected_date)}</td>
                    <td className="td"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="td">{r.supplier_status ? <Badge tone={supTone(r.supplier_status)}>{r.supplier_status}</Badge> : '—'}</td>
                    <td className="td text-right">
                      <div className="inline-flex gap-1">
                        {canWrite && <button onClick={() => setEdit(r)} className="rounded-md bg-white/5 px-2 py-1 text-xs text-ice-dim hover:text-ice">Edit</button>}
                        {canWrite && r.supplier_status !== 'accepted' && (
                          <button onClick={() => send(r)} className="rounded-md bg-accent/15 px-2 py-1 text-xs text-accent hover:bg-accent/25"><Send size={12} className="inline" /> Send</button>
                        )}
                        {canWrite && !r.bill_id && ['sent', 'received'].includes(r.status) && (
                          <button onClick={() => raiseBill(r)} className="rounded-md bg-ok/15 px-2 py-1 text-xs text-ok hover:bg-ok/25" title="Raise a payable from this PO"><Receipt size={12} className="inline" /> Bill</button>
                        )}
                        {r.bill_id && <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-ice-faint" title="A bill has been raised">Billed</span>}
                        {canWrite && <button onClick={() => del(r)} className="rounded-md p-1.5 text-ice-faint hover:bg-bad/10 hover:text-bad"><X size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit PO drawer */}
      {edit && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm animate-fade-in" onClick={() => setEdit(null)} />
          <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-navy-800 shadow-pop animate-slide-in sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-2xl sm:border">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="font-display text-lg font-bold text-ice">{edit.id ? 'Edit Purchase Order' : 'New Purchase Order'}</h2>
              <button onClick={() => setEdit(null)} className="text-ice-faint hover:text-ice"><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="PO number"><input className="input" value={edit.po_number || ''} onChange={(e) => setEdit({ ...edit, po_number: e.target.value })} /></Field>
              <Field label="Supplier"><Select value={edit.supplier_id || ''} onChange={(e) => setEdit({ ...edit, supplier_id: e.target.value })} options={[{ value: '', label: '—' }, ...suppliers.map((s) => ({ value: s.id, label: s.email ? s.name : `${s.name} (no email)` }))]} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status"><Select value={edit.status || 'draft'} onChange={(e) => setEdit({ ...edit, status: e.target.value })} options={PO_STATUS.map((s) => ({ value: s, label: s }))} /></Field>
                <Field label={`Total (${ccy})`}><input className="input" type="number" value={edit.total ?? 0} onChange={(e) => setEdit({ ...edit, total: e.target.value })} /></Field>
              </div>
              <Field label="Expected date"><input className="input" type="date" value={edit.expected_date || ''} onChange={(e) => setEdit({ ...edit, expected_date: e.target.value })} /></Field>
              <Field label="CC others on supplier email (comma-separated)"><input className="input" value={edit.cc_emails || ''} onChange={(e) => setEdit({ ...edit, cc_emails: e.target.value })} placeholder="buyer@company.com" /></Field>
              <Field label="Notes"><textarea className="input min-h-[70px]" value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
              {edit.supplier_status === 'accepted' && <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">Supplier accepted — a bill was created in Accounts → Bills.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
              <button onClick={() => setEdit(null)} className="btn-ghost">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save PO'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Procurement() {
  const [tab, setTab] = useState('requests')
  const { rows: suppliers } = useTable('suppliers')

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'requests' && <Requests suppliers={suppliers} />}
      {tab === 'orders' && <PurchaseOrders suppliers={suppliers} />}
      {tab === 'suppliers' && <Suppliers />}
    </div>
  )
}
