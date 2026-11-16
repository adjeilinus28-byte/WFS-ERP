import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast, Select } from './ui'
import { at } from '../lib/tr'

// Settings panel: who may approve each kind of request, an auto-approve limit,
// and whether people may approve their own requests. The database enforces
// these rules (migration 0056); this panel only edits them.
export const RULE_TYPES = [
  { type: 'leave', label: 'Leave requests', unit: 'days', hint: 'Requests shorter than this are approved automatically.' },
  { type: 'purchase_request', label: 'Purchase requests', unit: 'currency', hint: 'Requests estimated below this amount are approved automatically.' },
  { type: 'overtime', label: 'Overtime', unit: 'hours', hint: 'Entries below this many hours are approved automatically.' },
  { type: 'journal', label: 'Manual journals', unit: null, hint: 'Manual journals are always reviewed.' },
]
export const DEFAULT_RULE = { approver_role: 'manager', auto_approve_below: 0, block_self: true }
const ROLES = [
  { value: 'supervisor', label: 'Supervisor or above' },
  { value: 'manager', label: 'Manager or above' },
  { value: 'admin', label: 'Admin or above' },
  { value: 'owner', label: 'Owner only' },
]

export function useApprovalRules() {
  const { activeOrgId } = useAuth()
  const [rules, setRules] = useState({})
  const [loaded, setLoaded] = useState(false)
  const reload = async () => {
    if (!activeOrgId) return
    const { data } = await supabase.from('approval_rules').select('*').eq('org_id', activeOrgId)
    const m = {}
    for (const t of RULE_TYPES) m[t.type] = { ...DEFAULT_RULE }
    for (const r of data || []) m[r.item_type] = { approver_role: r.approver_role, auto_approve_below: Number(r.auto_approve_below || 0), block_self: r.block_self }
    setRules(m); setLoaded(true)
  }
  useEffect(() => { reload() }, [activeOrgId])   // eslint-disable-line react-hooks/exhaustive-deps
  return { rules, loaded, reload }
}

export default function ApprovalRules({ canAdmin, currency = 'GHS' }) {
  const { activeOrgId } = useAuth()
  const toast = useToast()
  const { rules, loaded, reload } = useApprovalRules()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (loaded) setForm(rules) }, [loaded, rules])

  const set = (type, k, v) => setForm((f) => ({ ...f, [type]: { ...(f[type] || DEFAULT_RULE), [k]: v } }))

  const save = async () => {
    setSaving(true)
    const rows = RULE_TYPES.map(({ type }) => {
      const r = form[type] || DEFAULT_RULE
      return {
        org_id: activeOrgId, item_type: type, approver_role: r.approver_role,
        auto_approve_below: type === 'journal' ? 0 : Math.max(0, Number(r.auto_approve_below || 0)),
        block_self: !!r.block_self, updated_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase.from('approval_rules').upsert(rows, { onConflict: 'org_id,item_type' })
    if (error) toast.error(error.message)
    else { toast.success('Approval rules saved'); reload() }
    setSaving(false)
  }

  const unitLabel = (u) => (u === 'currency' ? currency : u)

  return (
    <div className="panel p-5 lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">{at('Approval rules')}</div>
          <p className="max-w-2xl text-xs text-ice-faint">
            {at('Who can approve each kind of request. Set an auto-approve limit to let small requests through without waiting. An auto-approve limit of 0 means everything needs approval.')}
          </p>
        </div>
        {canAdmin && <button className="btn-primary btn-sm" onClick={save} disabled={saving || !loaded}>{saving ? at('Saving…') : at('Save rules')}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr>
            <th className="th">{at('Request type')}</th>
            <th className="th">{at('Who can approve')}</th>
            <th className="th">{at('Auto-approve below')}</th>
            <th className="th">{at('Own requests')}</th>
          </tr></thead>
          <tbody>
            {RULE_TYPES.map(({ type, label, unit, hint }) => {
              const r = form[type] || DEFAULT_RULE
              return (
                <tr key={type}>
                  <td className="td">
                    <div className="font-medium text-ice">{at(label)}</div>
                    <div className="text-[11px] text-ice-faint">{at(hint)}</div>
                  </td>
                  <td className="td w-52">
                    <Select value={r.approver_role} disabled={!canAdmin} translateOptions
                      onChange={(e) => set(type, 'approver_role', e.target.value)} options={ROLES} />
                  </td>
                  <td className="td w-48">
                    {unit ? (
                      <div className="flex items-center gap-2">
                        <input className="input w-28" type="number" min="0" step={unit === 'currency' ? '100' : '0.5'}
                          value={r.auto_approve_below ?? 0} disabled={!canAdmin}
                          onChange={(e) => set(type, 'auto_approve_below', e.target.value)} />
                        <span className="text-xs text-ice-faint">{at(unitLabel(unit))}</span>
                      </div>
                    ) : <span className="text-xs text-ice-faint">{at('Always reviewed')}</span>}
                  </td>
                  <td className="td w-56">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ice-dim">
                      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={!!r.block_self} disabled={!canAdmin}
                        onChange={(e) => set(type, 'block_self', e.target.checked)} />
                      {at("Can't approve own")}
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-ice-faint">
        {at('Tip: in a one-person workspace, untick "Can\'t approve own" or nobody will be able to approve your requests.')}
      </p>
    </div>
  )
}
