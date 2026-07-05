import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTable } from '../hooks/useTable'
import { useDepartments } from '../hooks/useDepartments'
import { PageHeader, StatCard, Badge, Field, Select, useToast, EmptyState } from '../components/ui'
import ModuleScaffold from '../components/ModuleScaffold'
import { money, num } from '../lib/format'
import {
  UtensilsCrossed, Store, CalendarDays, Lock, AlertCircle, Plus, X, Check, Ban, TrendingUp, Users, ChefHat,
} from 'lucide-react'

const MEALS = ['breakfast', 'lunch', 'dinner']
const CARD = { background: '#0E1424', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }
const iso = (d) => d.toISOString().slice(0, 10)
const CUTOFF_DAYS = 2

function Tabs({ tab, setTab, canManage }) {
  const items = [['order', 'My Orders'], ['dashboard', 'Order Dashboard']]
  if (canManage) { items.push(['vendors', 'Vendors'], ['menu', 'Menu Manager']) }
  return (
    <div className="mb-5 inline-flex flex-wrap rounded-lg border border-white/10 bg-navy/40 p-1">
      {items.map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-accent text-navy' : 'text-ice-dim hover:text-ice'}`}>{l}</button>
      ))}
    </div>
  )
}

// ── Worker ordering: next 7 days × meal types ────────────────────────────────
function MyOrders() {
  const { activeOrgId, activeOrg, user } = useAuth()
  const toast = useToast()
  const ccy = activeOrg?.currency || 'GHS'
  const { rows: employees } = useTable('employees')
  const [me, setMe] = useState(null)
  const [menus, setMenus] = useState([])
  const [orders, setOrders] = useState([])
  const [leaveDates, setLeaveDates] = useState(new Set())
  const [loading, setLoading] = useState(true)

  // 7 upcoming days
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return iso(d) }), [])

  // Resolve "me" — match the logged-in user's employee record by email
  useEffect(() => {
    if (!employees.length || !user?.email) return
    setMe(employees.find((e) => (e.email || '').toLowerCase() === user.email.toLowerCase()) || null)
  }, [employees, user])

  const load = async () => {
    if (!activeOrgId) return
    setLoading(true)
    const [{ data: m }, { data: o }, { data: lv }] = await Promise.all([
      supabase.from('menu_items').select('*, food_vendors(name)').eq('org_id', activeOrgId).in('service_date', days).eq('available', true),
      supabase.from('food_orders').select('*').eq('org_id', activeOrgId).in('service_date', days),
      me ? supabase.from('leave_requests').select('start_date,end_date').eq('org_id', activeOrgId).eq('employee_id', me.id).eq('status', 'approved') : Promise.resolve({ data: [] }),
    ])
    setMenus(m || [])
    setOrders((o || []).filter((r) => me && r.employee_id === me.id))
    // Expand leave ranges into a set of dates
    const set = new Set()
    ;(lv || []).forEach((l) => { let d = new Date(l.start_date); const end = new Date(l.end_date); while (d <= end) { set.add(iso(d)); d.setDate(d.getDate() + 1) } })
    setLeaveDates(set)
    setLoading(false)
  }
  useEffect(() => { if (me !== null || employees.length) load() }, [activeOrgId, me, days.join(',')])

  const isLocked = (date) => { const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + CUTOFF_DAYS); return new Date(date) < cutoff }
  const orderFor = (date, meal) => orders.find((o) => o.service_date === date && o.meal_type === meal)
  const menuFor = (date, meal) => menus.filter((m) => m.service_date === date && m.meal_type === meal)

  const place = async (date, meal, payload) => {
    if (!me) { toast.error('Your account is not linked to an employee record'); return }
    if (isLocked(date)) { toast.error('This day is locked (within 2-day cutoff)'); return }
    if (leaveDates.has(date)) { toast.error("You're on leave that day"); return }
    const existing = orderFor(date, meal)
    const base = {
      org_id: activeOrgId, employee_id: me.id, employee_name: me.full_name, department: me.department,
      service_date: date, meal_type: meal, updated_at: new Date().toISOString(), ...payload,
    }
    try {
      if (existing) { const { error } = await supabase.from('food_orders').update(base).eq('id', existing.id); if (error) throw error }
      else { const { error } = await supabase.from('food_orders').insert(base); if (error) throw error }
      await load()
    } catch (e) { toast.error(e.message) }
  }

  if (!me && !loading) return (
    <div className="panel px-6 py-16 text-center">
      <UtensilsCrossed size={28} className="mx-auto text-ice-faint" />
      <p className="mt-3 font-display text-lg font-bold text-ice">Account not linked to an employee</p>
      <p className="mt-1 text-sm text-ice-faint">Ask an admin to add you in Workforce with this login email so you can place meal orders.</p>
    </div>
  )

  const orderedCount = orders.filter((o) => !o.no_meal).length
  const spend = orders.reduce((s, o) => s + Number(o.price || 0), 0)

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Days open" value={days.filter((d) => !isLocked(d) && !leaveDates.has(d)).length} icon={CalendarDays} />
        <StatCard label="Meals ordered" value={orderedCount} icon={UtensilsCrossed} />
        <StatCard label="Est. spend" value={money(spend, ccy)} icon={TrendingUp} />
        <StatCard label="On-leave days" value={days.filter((d) => leaveDates.has(d)).length} icon={Ban} />
      </div>

      {loading ? <div className="panel p-8 text-center text-ice-faint">Loading…</div>
      : (
        <div className="space-y-3">
          {days.map((date) => {
            const locked = isLocked(date)
            const onLeave = leaveDates.has(date)
            const dObj = new Date(date)
            return (
              <div key={date} className={`panel p-4 ${onLeave ? 'opacity-60' : ''}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-display text-base font-bold text-ice">
                    {dObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                  </div>
                  {onLeave ? <Badge tone="mute"><Ban size={11} className="mr-1 inline" />On leave</Badge>
                  : locked ? <Badge tone="warn"><Lock size={11} className="mr-1 inline" />Locked</Badge>
                  : <Badge tone="ok">Open</Badge>}
                </div>
                {onLeave ? <p className="text-sm text-ice-faint">No meals — you're on approved leave.</p>
                : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {MEALS.map((meal) => (
                      <MealSlot key={meal} meal={meal} date={date} locked={locked}
                        options={menuFor(date, meal)} order={orderFor(date, meal)}
                        onPlace={(payload) => place(date, meal, payload)} ccy={ccy} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function MealSlot({ meal, date, locked, options, order, onPlace, ccy }) {
  const [open, setOpen] = useState(false)
  const [vendorId, setVendorId] = useState(order?.vendor_id || '')
  const [sel, setSel] = useState(order?.menu_item_id || '')
  const [allergies, setAllergies] = useState(order?.allergies || '')

  // Vendors available for this meal/day, then items for the chosen vendor
  const vendors = useMemo(() => {
    const m = {}
    options.forEach((o) => { if (o.vendor_id) m[o.vendor_id] = o.food_vendors?.name || 'Vendor' })
    return Object.entries(m).map(([id, name]) => ({ id, name }))
  }, [options])
  const vendorItems = options.filter((o) => o.vendor_id === vendorId)

  const commit = (itemId, noMeal) => {
    if (noMeal) { onPlace({ no_meal: true, menu_item_id: null, vendor_id: null, item_name: null, price: 0, allergies, status: 'placed', auto_selected: false }); setOpen(false); return }
    const item = options.find((o) => o.id === itemId)
    if (!item) return
    onPlace({ no_meal: false, menu_item_id: item.id, vendor_id: item.vendor_id, item_name: item.name, price: item.price, allergies, status: 'placed', auto_selected: false })
    setOpen(false)
  }

  const openPicker = () => {
    setOpen(!open)
    setVendorId(order?.vendor_id || (vendors.length === 1 ? vendors[0].id : ''))
    setSel(order?.menu_item_id || '')
    setAllergies(order?.allergies || '')
  }

  const label = meal[0].toUpperCase() + meal.slice(1)
  const summary = order?.no_meal ? 'No meal' : order?.item_name

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ice-faint">{label}</span>
        {order?.auto_selected && <Badge tone="mute">auto</Badge>}
      </div>
      {summary ? (
        <div>
          <div className={`text-sm ${order.no_meal ? 'text-ice-faint' : 'text-ice'}`}>{summary}</div>
          {!order.no_meal && <div className="font-mono text-[11px] text-ice-faint">{money(order.price, ccy)}</div>}
          {order.allergies && <div className="mt-0.5 text-[10px] text-warn">⚠ {order.allergies}</div>}
        </div>
      ) : <div className="text-sm text-ice-faint">{options.length ? 'Not ordered' : 'No menu'}</div>}

      {!locked && options.length > 0 && (
        <button onClick={openPicker} className="mt-2 w-full rounded-md bg-white/5 py-1 text-xs text-ice-dim hover:text-ice">
          {order ? 'Change' : 'Choose'}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-white/10 bg-navy/60 p-2">
          {/* Step 1 — vendor */}
          <div>
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-ice-faint">1 · Vendor</div>
            <Select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setSel('') }}
              options={[{ value: '', label: 'Select vendor…' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]} />
          </div>

          {/* Step 2 — item (only after a vendor is chosen) */}
          {vendorId && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-ice-faint">2 · Meal</div>
              <div className="space-y-1">
                {vendorItems.length === 0 ? <p className="px-1 text-[11px] text-ice-faint">No {meal} items from this vendor.</p>
                : vendorItems.map((o) => (
                  <button key={o.id} onClick={() => setSel(o.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${sel === o.id ? 'bg-accent-soft text-accent' : 'text-ice-dim hover:bg-white/5'}`}>
                    <span>{o.name}</span>
                    <span className="font-mono">{money(o.price, ccy)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="Allergies (optional)"
            className="w-full rounded-md border border-white/10 bg-navy/50 px-2 py-1 text-xs text-ice placeholder:text-ice-faint/60 outline-none" />
          <div className="flex gap-1.5">
            <button onClick={() => commit(sel, false)} disabled={!sel} className="flex-1 rounded-md bg-accent py-1 text-xs font-semibold text-navy disabled:opacity-40"><Check size={12} className="inline" /> Confirm</button>
            <button onClick={() => commit(null, true)} className="rounded-md bg-white/5 px-2 py-1 text-xs text-ice-dim hover:text-ice" title="No meal this day"><Ban size={12} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Order dashboard: counts per vendor / menu for next 7 days ────────────────
function OrderDashboard() {
  const { activeOrgId } = useAuth()
  const [counts, setCounts] = useState([])
  const [day, setDay] = useState('')
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return iso(d) }), [])

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('food_order_counts').select('*').eq('org_id', activeOrgId).in('service_date', days)
      .then(({ data }) => setCounts(data || []))
  }, [activeOrgId, days.join(',')])

  const filtered = day ? counts.filter((c) => c.service_date === day) : counts

  // Aggregate by vendor + item
  const byItem = useMemo(() => {
    const m = {}
    filtered.forEach((c) => { const k = `${c.vendor_name || '—'} · ${c.item_name}`; const x = (m[k] ||= { label: k, orders: 0, value: 0 }); x.orders += Number(c.orders_placed || 0); x.value += Number(c.total_value || 0) })
    return Object.values(m).sort((a, b) => b.orders - a.orders)
  }, [filtered])

  const totalOrders = filtered.reduce((s, c) => s + Number(c.orders_placed || 0), 0)
  const vendors = [...new Set(filtered.map((c) => c.vendor_name))].filter(Boolean)

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Orders (next 7d)" value={totalOrders} icon={UtensilsCrossed} />
        <StatCard label="Active vendors" value={vendors.length} icon={Store} />
        <StatCard label="Menu items ordered" value={byItem.length} icon={ChefHat} />
        <StatCard label="Days shown" value={day ? 1 : 7} icon={CalendarDays} />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Day:</span>
        <div className="w-52"><Select value={day} onChange={(e) => setDay(e.target.value)}
          options={[{ value: '', label: 'All 7 days' }, ...days.map((d) => ({ value: d, label: new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) }))]} /></div>
      </div>

      {byItem.length === 0 ? <EmptyState title="No orders yet" hint="Orders placed by the workforce will summarise here per vendor and menu item." />
      : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-5">
            <div className="eyebrow mb-4">Orders per menu item</div>
            <ResponsiveContainer width="100%" height={Math.max(240, byItem.length * 34)}>
              <BarChart data={byItem} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={140} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={CARD} />
                <Bar dataKey="orders" radius={[0, 5, 5, 0]} fill="rgb(var(--accent))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-3"><span className="eyebrow">Breakdown</span></div>
            <table className="w-full">
              <thead className="bg-white/[0.02]"><tr><th className="th">Vendor · Item</th><th className="th">Orders</th><th className="th">Value</th></tr></thead>
              <tbody>
                {byItem.map((r, i) => (
                  <tr key={i} className="transition hover:bg-white/[0.025]">
                    <td className="td text-sm">{r.label}</td>
                    <td className="td font-mono">{r.orders}</td>
                    <td className="td font-mono">{num(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Menu manager: 14-day menu, near-7 locked, far-7 editable ─────────────────
function MenuManager() {
  const { activeOrgId } = useAuth()
  const toast = useToast()
  const { rows: vendors } = useTable('food_vendors')
  const [vendorId, setVendorId] = useState('')
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState({ service_date: '', meal_type: 'lunch', name: '', price: '' })

  const days14 = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i + 1); return iso(d) }), [])
  const isLocked = (date) => { const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + CUTOFF_DAYS); return new Date(date) < cutoff }

  const load = () => {
    if (!activeOrgId || !vendorId) { setItems([]); return }
    supabase.from('menu_items').select('*').eq('org_id', activeOrgId).eq('vendor_id', vendorId).in('service_date', days14)
      .order('service_date').then(({ data }) => setItems(data || []))
  }
  useEffect(load, [activeOrgId, vendorId, days14.join(',')])

  const add = async () => {
    if (!vendorId || !draft.service_date || !draft.name) { toast.error('Vendor, date, and name required'); return }
    if (isLocked(draft.service_date)) { toast.error('That date is within the 2-day lock'); return }
    try {
      const { error } = await supabase.from('menu_items').insert({ org_id: activeOrgId, vendor_id: vendorId, ...draft, price: Number(draft.price || 0) })
      if (error) throw error
      setDraft({ service_date: '', meal_type: 'lunch', name: '', price: '' }); load(); toast.success('Menu item added')
    } catch (e) { toast.error(e.message) }
  }
  const del = async (it) => {
    if (isLocked(it.service_date)) { toast.error('Locked — within 2-day window'); return }
    try { await supabase.from('menu_items').delete().eq('id', it.id); load() } catch (e) { toast.error(e.message) }
  }

  return (
    <div>
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ice-faint">Vendor:</span>
        <div className="w-56"><Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} options={[{ value: '', label: 'Select vendor…' }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]} /></div>
      </div>

      {!vendorId ? <EmptyState title="Select a vendor" hint="Choose a vendor to view and edit their 14-day menu." />
      : (
        <>
          <div className="panel mb-4 p-4">
            <div className="eyebrow mb-3">Add menu item</div>
            <div className="grid gap-3 sm:grid-cols-5">
              <Field label="Date"><Select value={draft.service_date} onChange={(e) => setDraft({ ...draft, service_date: e.target.value })}
                options={[{ value: '', label: 'Select…' }, ...days14.filter((d) => !isLocked(d)).map((d) => ({ value: d, label: new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) }))]} /></Field>
              <Field label="Meal"><Select value={draft.meal_type} onChange={(e) => setDraft({ ...draft, meal_type: e.target.value })} options={MEALS.map((m) => ({ value: m, label: m }))} /></Field>
              <div className="sm:col-span-2"><Field label="Item name"><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field></div>
              <Field label="Price"><input className="input" type="number" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
            </div>
            <button onClick={add} className="btn-primary btn-sm mt-3"><Plus size={14} /> Add item</button>
          </div>

          <div className="space-y-2">
            {days14.map((date) => {
              const dayItems = items.filter((i) => i.service_date === date)
              const locked = isLocked(date)
              return (
                <div key={date} className={`panel p-3 ${locked ? 'opacity-70' : ''}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-display text-sm font-bold text-ice">{new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    {locked ? <Badge tone="warn"><Lock size={10} className="mr-1 inline" />Live/locked</Badge> : <Badge tone="ok">Editable</Badge>}
                  </div>
                  {dayItems.length === 0 ? <p className="text-xs text-ice-faint">No items</p>
                  : (
                    <div className="flex flex-wrap gap-2">
                      {dayItems.map((it) => (
                        <div key={it.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs">
                          <Badge tone="mute">{it.meal_type}</Badge>
                          <span className="text-ice">{it.name}</span>
                          <span className="font-mono text-ice-faint">{num(it.price)}</span>
                          {!locked && <button onClick={() => del(it)} className="text-ice-faint hover:text-bad"><X size={12} /></button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Catering() {
  const { role } = useAuth()
  const canManage = ['owner', 'admin', 'manager', 'supervisor'].includes(role)
  const [tab, setTab] = useState('order')

  return (
    <div>
      <PageHeader eyebrow="Workplace" title="Catering & Meals" />
      <Tabs tab={tab} setTab={setTab} canManage={canManage} />
      {tab === 'order' && <MyOrders />}
      {tab === 'dashboard' && <OrderDashboard />}
      {tab === 'vendors' && canManage && (
        <ModuleScaffold
          eyebrow="Workplace" title="Food Vendors" table="food_vendors"
          newLabel="New vendor" emptyTitle="No vendors" emptyHint="Add catering vendors, then set their menus in the Menu Manager."
          searchKeys={['name', 'contact_name', 'cuisine']}
          columns={[
            { key: 'name', label: 'Vendor' },
            { key: 'cuisine', label: 'Cuisine', render: (v) => v ? <Badge>{v}</Badge> : '—' },
            { key: 'contact_name', label: 'Contact' },
            { key: 'phone', label: 'Phone' },
            { key: 'active', label: 'Active', render: (v) => <Badge tone={v ? 'ok' : 'mute'}>{v ? 'active' : 'off'}</Badge> },
          ]}
          fields={[
            { key: 'name', label: 'Vendor name', required: true, span: true },
            { key: 'cuisine', label: 'Cuisine' },
            { key: 'contact_name', label: 'Contact name' },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'notes', label: 'Notes', type: 'textarea', span: true },
          ]}
          beforeSave={(p) => ({ ...p, active: p.active ?? true })}
          kpis={(rows) => <>
            <StatCard label="Vendors" value={rows.length} icon={Store} />
            <StatCard label="Active" value={rows.filter((r) => r.active).length} tone="ok" icon={Check} />
            <StatCard label="Cuisines" value={[...new Set(rows.map((r) => r.cuisine).filter(Boolean))].length} icon={ChefHat} />
            <StatCard label="With email" value={rows.filter((r) => r.email).length} icon={Users} />
          </>}
        />
      )}
      {tab === 'menu' && canManage && <MenuManager />}
    </div>
  )
}
