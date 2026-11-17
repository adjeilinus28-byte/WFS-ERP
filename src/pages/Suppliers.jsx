import { useEffect, useMemo, useState } from 'react'
import { Truck, Wallet, Crown, ShieldAlert } from 'lucide-react'
import ModuleScaffold from '../components/ModuleScaffold'
import { Badge, StatCard } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, date, daysUntil } from '../lib/format'
import { at } from '../lib/tr'

// Suppliers with compliance (TIN, tax clearance expiry, bank details) and spend
// (from supplier bills this year), plus open purchase-order commitments.
const SPEND_EXCLUDED = new Set(['draft', 'cancelled'])

export function clearanceState(expiry) {
  if (!expiry) return { tone: 'warn', label: 'Missing', chase: true }
  const d = daysUntil(expiry)
  if (d < 0) return { tone: 'bad', label: 'Expired', chase: true }
  if (d <= 30) return { tone: 'warn', label: d === 0 ? 'Expires today' : `${d} day${d === 1 ? '' : 's'} left`, chase: true }
  return { tone: 'ok', label: `Valid · ${date(expiry)}`, chase: false }
}

export default function Suppliers() {
  const { activeOrgId, activeOrg } = useAuth()
  const ccy = activeOrg?.currency || 'GHS'
  const [bills, setBills] = useState([])
  const [pos, setPos] = useState([])
  const year = String(new Date().getFullYear())

  useEffect(() => {
    if (!activeOrgId) return
    Promise.all([
      supabase.from('bills').select('supplier_id, supplier_name, supplier, total, amount, status, issue_date, created_at').eq('org_id', activeOrgId),
      supabase.from('purchase_orders').select('supplier_id, total, status').eq('org_id', activeOrgId),
    ]).then(([b, p]) => { setBills(b.data || []); setPos(p.data || []) })
  }, [activeOrgId])

  // Spend this year and open commitments, keyed by supplier id (or name for
  // bills recorded without a supplier link).
  const spend = useMemo(() => {
    const byId = {}, byName = {}
    for (const b of bills) {
      if (SPEND_EXCLUDED.has(b.status)) continue
      if (!String(b.issue_date || b.created_at || '').startsWith(year)) continue
      const amt = Number(b.total || b.amount || 0)
      if (b.supplier_id) byId[b.supplier_id] = (byId[b.supplier_id] || 0) + amt
      else { const k = String(b.supplier_name || b.supplier || '').trim().toLowerCase(); if (k) byName[k] = (byName[k] || 0) + amt }
    }
    const committed = {}
    for (const p of pos) if (p.supplier_id && !['closed', 'cancelled', 'billed', 'received'].includes(p.status)) committed[p.supplier_id] = (committed[p.supplier_id] || 0) + Number(p.total || 0)
    return { of: (s) => (byId[s.id] || 0) + (byName[String(s.name || '').trim().toLowerCase()] || 0), committed }
  }, [bills, pos, year])

  return (
    <ModuleScaffold
      eyebrow="Supply Chain" title="Suppliers" sub="Vendors you buy from, their tax compliance and what you spend with them." table="suppliers"
      newLabel="New supplier" emptyTitle="No suppliers"
      emptyHint="Build your approved vendor list. Add an email so POs can be sent for approval, and a tax clearance expiry so you're reminded before it lapses."
      searchKeys={['name', 'contact_name', 'email', 'category', 'tin']}
      columns={[
        { key: 'name', label: 'Supplier', render: (v, r) => <div><div className="font-medium text-ice">{v}</div>{r.tin && <div className="font-mono text-[11px] text-ice-faint">TIN {r.tin}</div>}</div> },
        { key: 'category', label: 'Category', render: (v) => v ? <Badge>{v}</Badge> : '—' },
        { key: 'contact_name', label: 'Contact', render: (v, r) => <div><div>{v || '—'}</div>{(r.phone || r.email) && <div className="text-[11px] text-ice-faint">{r.phone || r.email}</div>}</div> },
        { key: 'tax_clearance_expiry', label: 'Tax clearance', render: (v) => { const c = clearanceState(v); return <Badge tone={c.tone} plain>{at(c.label)}</Badge> } },
        { key: '_spend', label: `Spend ${year}`, render: (_, r) => <span className="font-mono">{money(spend.of(r), ccy)}</span> },
        { key: 'status', label: 'Status', render: (v) => <Badge tone={v === 'inactive' ? 'mute' : 'ok'}>{v || 'active'}</Badge> },
      ]}
      fields={[
        { key: 'name', label: 'Supplier name', required: true, span: true },
        { key: 'category', label: 'Category', type: 'select', options: ['Materials', 'Contractor', 'Subcontractor', 'Plant hire', 'OEM / spares', 'Fuel & lubricants', 'Services', 'Catering', 'Other'].map((c) => ({ value: c, label: c })) },
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }], default: 'active' },
        { key: 'contact_name', label: 'Contact name' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email (for PO approval)', type: 'email', span: true },
        { key: 'tin', label: 'TIN (Ghana Revenue Authority)' },
        { key: 'tax_clearance_no', label: 'Tax clearance certificate no.' },
        { key: 'tax_clearance_expiry', label: 'Tax clearance expiry', type: 'date' },
        { key: 'bank_name', label: 'Bank' },
        { key: 'bank_account', label: 'Bank account number', span: true },
        { key: 'address', label: 'Address', type: 'textarea', span: true },
        { key: 'notes', label: 'Notes', type: 'textarea', span: true },
      ]}
      kpis={(rows) => {
        const active = rows.filter((r) => (r.status || 'active') === 'active')
        const total = rows.reduce((t, r) => t + spend.of(r), 0)
        const top = rows.map((r) => ({ r, v: spend.of(r) })).sort((a, b) => b.v - a.v)[0]
        const chase = active.filter((r) => clearanceState(r.tax_clearance_expiry).chase).length
        return <>
          <StatCard label="Active suppliers" value={active.length} icon={Truck} sub={`${rows.length - active.length} ${at('inactive')}`} />
          <StatCard label={`Billed ${year}`} value={money(total, ccy)} icon={Wallet} sub={at('All bills except drafts and cancelled')} />
          <StatCard label="Largest supplier" value={top && top.v > 0 ? top.r.name : '—'} icon={Crown} sub={top && top.v > 0 ? money(top.v, ccy) : at('No bills yet')} />
          <StatCard label="Tax clearance to chase" value={chase} tone={chase ? 'warn' : 'ok'} icon={ShieldAlert} sub={at('Missing, expired or expiring in 30 days')} />
        </>
      }}
      extra={(rows) => {
        const withSpend = rows.map((r) => ({ r, v: spend.of(r) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
        const total = withSpend.reduce((t, x) => t + x.v, 0)
        if (!total) return null
        const byCat = {}
        for (const { r, v } of withSpend) byCat[r.category || 'Uncategorised'] = (byCat[r.category || 'Uncategorised'] || 0) + v
        const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1])
        return (
          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <div className="panel p-5">
              <h2 className="font-display text-[17px] font-bold text-ice">{at('Spend by category')}</h2>
              <p className="mb-4 text-xs text-ice-faint">{year} · {money(total, ccy)}</p>
              <div className="space-y-3">
                {cats.map(([c, v]) => (
                  <div key={c}>
                    <div className="mb-1 flex justify-between text-[13px]"><span className="text-ice-dim">{c}</span><span className="font-mono text-ice">{Math.round((v / total) * 100)}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (v / total) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel p-5">
              <h2 className="font-display text-[17px] font-bold text-ice">{at('Top suppliers by spend')}</h2>
              <p className="mb-4 text-xs text-ice-faint">{at('Bills this year, plus open purchase orders')}</p>
              <div className="space-y-2">
                {withSpend.slice(0, 5).map(({ r, v }) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                    <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-ice">{r.name}</div>
                      <div className="text-[11px] text-ice-faint">{r.category || at('Uncategorised')} · {Math.round((v / total) * 100)}% {at('of spend')}{spend.committed[r.id] ? ` · ${money(spend.committed[r.id], ccy)} ${at('on open POs')}` : ''}</div></div>
                    <span className="shrink-0 font-mono text-sm text-ice">{money(v, ccy)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      }}
    />
  )
}
