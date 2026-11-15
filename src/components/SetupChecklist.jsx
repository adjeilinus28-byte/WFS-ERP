import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, X, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { at } from '../lib/tr'

// "Get set up" card for owners and admins on the Command Deck. Each step is
// ticked from real data, so it completes itself as the workspace is filled in.
// Hidden once everything is done, or when dismissed (remembered per workspace
// in this browser).
// Counts a named column, never '*': employees only grants its directory columns
// (private HR fields are hidden), so a '*' count is rejected with a 403.
const count = async (table, orgId, col = 'id') => {
  const { count: c } = await supabase.from(table).select(col, { count: 'exact', head: true }).eq('org_id', orgId)
  return c || 0
}

export default function SetupChecklist() {
  const { activeOrgId, activeOrg, role } = useAuth()
  const mods = activeOrg?.enabled_modules || []
  const has = (m) => mods.includes(m)
  const key = `wfs-setup-dismissed:${activeOrgId}`
  const [steps, setSteps] = useState(null)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const isAdmin = ['owner', 'admin'].includes(role)

  useEffect(() => {
    if (!activeOrgId || !isAdmin || hidden) return
    let alive = true
    ;(async () => {
      const [{ data: org }, depts, emps, members, assets, items, { data: tax }] = await Promise.all([
        supabase.from('organizations').select('contact_email, address, hse_head_email, ops_head_email').eq('id', activeOrgId).maybeSingle(),
        count('departments', activeOrgId),
        has('workforce') ? count('employees', activeOrgId) : 0,
        count('org_members', activeOrgId, 'user_id'),
        has('assets') ? count('assets', activeOrgId) : 0,
        has('inventory') ? count('inventory_items', activeOrgId) : 0,
        has('accounts') ? supabase.from('tax_settings').select('org_id').eq('org_id', activeOrgId).maybeSingle() : Promise.resolve({ data: null }),
      ])
      if (!alive) return
      const list = [
        { label: 'Add your company contact details', done: !!(org?.contact_email && org?.address), to: '/settings' },
        { label: 'Create your departments', done: depts > 0, to: '/workforce' },
        has('workforce') && { label: 'Add your employees', done: emps > 0, to: '/workforce' },
        { label: 'Invite your team', done: members > 1, to: '/team' },
        (has('assets') || has('inventory')) && { label: 'Add your first asset or stock item', done: assets + items > 0, to: has('assets') ? '/assets' : '/inventory' },
        has('accounts') && { label: 'Confirm payroll tax settings', done: !!tax, to: '/accounts' },
        has('hse') && { label: 'Set who receives safety and operations alerts', done: !!(org?.hse_head_email || org?.ops_head_email), to: '/settings' },
      ].filter(Boolean)
      setSteps(list)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, isAdmin, hidden, mods.join(',')])

  if (!isAdmin || hidden || !steps) return null
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  const pct = Math.round((done / steps.length) * 100)
  const dismiss = () => { try { localStorage.setItem(key, '1') } catch { /* private mode */ } setHidden(true) }

  return (
    <div className="panel mb-5 p-5 lg:p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[17px] font-bold leading-tight text-ice">{at('Get your workspace set up')}</h2>
          <p className="mt-0.5 text-xs text-ice-faint">{done} {at('of')} {steps.length} {at('done')} · {at('each step ticks itself off as you add data')}</p>
        </div>
        <button onClick={dismiss} aria-label={at('Hide setup checklist')} title={at('Hide')}
          className="rounded-md p-1.5 text-ice-faint hover:bg-white/5 hover:text-ice"><X size={16} /></button>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => s.done ? (
          <div key={s.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-ice-faint">
            <CheckCircle2 size={16} className="shrink-0 text-ok" />
            <span className="line-through decoration-white/20">{at(s.label)}</span>
          </div>
        ) : (
          <Link key={s.label} to={s.to} className="group flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-ice transition hover:bg-white/[0.06]">
            <Circle size={16} className="shrink-0 text-ice-faint" />
            <span className="flex-1">{at(s.label)}</span>
            <ArrowRight size={13} className="shrink-0 text-ice-faint transition group-hover:text-accent" />
          </Link>
        ))}
      </div>
    </div>
  )
}
