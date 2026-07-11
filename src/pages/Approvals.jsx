import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, EmptyState, Badge, useToast } from '../components/ui'
import { money, date } from '../lib/format'
import { at } from '../lib/tr'
import { CalendarCheck, ShoppingCart, BookOpen, Check, X, Inbox, Clock } from 'lucide-react'

// One inbox for everything awaiting a decision. Each source keeps its own native
// approval mechanism — this page just gathers them and applies the same update
// each module already uses, so behaviour is identical to approving in-place.
const APPROVER_ROLES = ['owner', 'admin', 'manager', 'supervisor']

const SOURCES = {
  leave: {
    label: 'Leave', icon: CalendarCheck, link: '/hr',
    title: (r) => `${r.employee_name || 'Employee'} — ${r.leave_type || 'leave'}`,
    detail: (r, ccy) => `${r.days || '?'} ${at('days')} · ${date(r.start_date)} → ${date(r.end_date)}`,
  },
  preq: {
    label: 'Purchase request', icon: ShoppingCart, link: '/procurement',
    title: (r) => r.title || 'Purchase request',
    detail: (r, ccy) => [r.department, r.est_total ? money(r.est_total, ccy) : null].filter(Boolean).join(' · '),
  },
  journal: {
    label: 'Journal', icon: BookOpen, link: '/financials',
    title: (r) => r.memo || `Entry ${r.entry_no || ''}`,
    detail: (r, ccy) => `${at('Manual entry')} · ${date(r.entry_date)}`,
  },
}

export default function Approvals() {
  const { activeOrgId, activeOrg, role, user } = useAuth()
  const toast = useToast()
  const ccy = activeOrg?.currency || 'GHS'
  const canApprove = APPROVER_ROLES.includes(role)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)      // ref being acted on
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    if (!activeOrgId) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      const [leave, preq, jrnl] = await Promise.all([
        supabase.from('leave_requests').select('*').eq('org_id', activeOrgId).eq('status', 'pending'),
        supabase.from('purchase_requests').select('*').eq('org_id', activeOrgId).eq('status', 'pending'),
        // Manual, unposted journal entries await posting (their form of approval).
        supabase.from('journal_entries').select('*').eq('org_id', activeOrgId).eq('posted', false).eq('source_type', 'manual'),
      ])
      const rows = [
        ...(leave.data || []).map((r) => ({ kind: 'leave', row: r, when: r.created_at })),
        ...(preq.data || []).map((r) => ({ kind: 'preq', row: r, when: r.created_at })),
        ...(jrnl.data || []).map((r) => ({ kind: 'journal', row: r, when: r.created_at })),
      ].sort((a, b) => new Date(a.when) - new Date(b.when))   // oldest first (FIFO queue)
      setItems(rows)
    } catch (e) {
      toast.error(e.message || 'Could not load approvals')
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, toast])

  useEffect(() => { load() }, [load])

  // Approve / reject using each type's native mechanism.
  const decide = async (item, approve) => {
    const key = `${item.kind}:${item.row.id}`
    setBusy(key)
    try {
      if (item.kind === 'leave' || item.kind === 'preq') {
        const table = item.kind === 'leave' ? 'leave_requests' : 'purchase_requests'
        const { error } = await supabase.from(table).update({
          status: approve ? 'approved' : 'declined',
          decided_by: user?.email, decided_at: new Date().toISOString(),
        }).eq('id', item.row.id)
        if (error) throw error
      } else if (item.kind === 'journal') {
        if (approve) {
          const { error } = await supabase.rpc('post_journal_entry', { p_entry: item.row.id })
          if (error) throw error
        } else {
          // Rejecting an unposted manual entry removes it (nothing was posted yet).
          const { error } = await supabase.from('journal_entries').delete().eq('id', item.row.id)
          if (error) throw error
        }
      }
      setItems((x) => x.filter((i) => `${i.kind}:${i.row.id}` !== key))
      toast.success(approve ? at('Approved') : at('Rejected'))
    } catch (e) {
      toast.error(e.message || 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter)
  const countBy = (k) => items.filter((i) => i.kind === k).length

  return (
    <div>
      <PageHeader eyebrow={at('Workflow')} title={at('Approvals')} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={at('Pending total')} value={items.length} icon={Inbox} tone={items.length ? 'warn' : 'ok'} />
        <StatCard label={at('Leave')} value={countBy('leave')} icon={CalendarCheck} />
        <StatCard label={at('Purchase requests')} value={countBy('preq')} icon={ShoppingCart} />
        <StatCard label={at('Journals')} value={countBy('journal')} icon={BookOpen} />
      </div>

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[['all', at('All')], ['leave', at('Leave')], ['preq', at('Purchase requests')], ['journal', at('Journals')]].map(([k, lbl]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${filter === k ? 'bg-accent text-navy' : 'bg-white/[0.04] text-ice-dim hover:text-ice'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {!canApprove ? (
        <EmptyState title={at('No access')} hint={at('You do not have permission to approve requests.')} />
      ) : loading ? (
        <div className="panel p-8 text-center text-sm text-ice-faint">{at('Loading…')}</div>
      ) : shown.length === 0 ? (
        <EmptyState title={at('All caught up')} hint={at('Nothing is awaiting your decision.')} />
      ) : (
        <div className="space-y-2">
          {shown.map((item) => {
            const src = SOURCES[item.kind]
            const Icon = src.icon
            const key = `${item.kind}:${item.row.id}`
            const acting = busy === key
            return (
              <div key={key} className="panel flex items-center gap-4 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-accent">
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ice">{src.title(item.row)}</span>
                    <Badge tone="warn">{at(src.label)}</Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-ice-faint">
                    <Clock size={11} /> {date(item.when)} · {src.detail(item.row, ccy)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => decide(item, false)} disabled={acting}
                    className="flex items-center gap-1 rounded-lg bg-bad/15 px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad/25 disabled:opacity-50">
                    <X size={13} /> {at('Reject')}
                  </button>
                  <button onClick={() => decide(item, true)} disabled={acting}
                    className="flex items-center gap-1 rounded-lg bg-ok/15 px-3 py-1.5 text-xs font-medium text-ok hover:bg-ok/25 disabled:opacity-50">
                    <Check size={13} /> {acting ? at('…') : at('Approve')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
