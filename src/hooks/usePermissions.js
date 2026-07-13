import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Single source of truth for client-side gating. Mirrors the DB helper
// can_in_domain(): loads the caller's effective level per domain for the active
// org, then exposes can(domain, minLevel). Replaces the 28 ad-hoc canWrite
// checks scattered across pages. The DB RLS enforces the same rules, so hiding a
// button here is convenience; the database is the real guard.
const RANK = { none: 0, view: 1, edit: 2, manage: 3 }

// Which domain each module/page belongs to (client mirror of the SQL mapping).
export const MODULE_DOMAIN = {
  // operations (maintenance)
  assets: 'operations', work_orders: 'operations',
  // supply chain
  inventory: 'supply_chain', procurement: 'supply_chain', issuance: 'supply_chain', ppe: 'supply_chain',
  // people
  workforce: 'people', shifts: 'people', hr: 'people', catering: 'people', ir: 'people',
  // finance
  financials: 'finance', accounts: 'finance',
  // compliance
  hse: 'compliance', training: 'compliance',
  // approvals / insight / admin
  approvals: 'approvals', reports: 'insight',
  settings: 'admin', team: 'admin',
}

export function usePermissions() {
  const { activeOrgId, isOwner } = useAuth()
  const [levels, setLevels] = useState({})   // { domain: level }
  const [loading, setLoading] = useState(true)
  const [deptScope, setDeptScope] = useState({ scope: 'all', homeDept: null })

  const load = useCallback(async () => {
    if (!activeOrgId) { setLevels({}); setLoading(false); return }
    try {
      const [{ data }, { data: ds }] = await Promise.all([
        supabase.rpc('my_permissions', { p_org: activeOrgId }),
        supabase.rpc('my_dept_scope', { p_org: activeOrgId }),
      ])
      const map = {}
      for (const r of data || []) map[r.domain] = r.level
      setLevels(map)
      if (ds && ds[0]) setDeptScope({ scope: ds[0].scope, homeDept: ds[0].home_dept })
    } catch { setLevels({}) } finally { setLoading(false) }
  }, [activeOrgId])

  useEffect(() => { load() }, [load])

  // can('finance','edit') — platform owners always pass.
  const can = useCallback((domain, min = 'view') => {
    if (isOwner) return true
    return (RANK[levels[domain]] ?? 0) >= (RANK[min] ?? 0)
  }, [levels, isOwner])

  // convenience: can this user write in the domain a module belongs to?
  const canWriteModule = useCallback((moduleKey) => {
    const d = MODULE_DOMAIN[moduleKey]
    return d ? can(d, 'edit') : true
  }, [can])

  // deptScope.scope: 'all'|'own_edit'|'own_only'; homeDept: the user's department.
  // Forms for scoped users should default new records' department to homeDept.
  return { can, canWriteModule, levels, deptScope, loading, reload: load }
}
