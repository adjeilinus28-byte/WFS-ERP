import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { EMP_PUBLIC_SELECT } from '../lib/employeeFields'

// Tenant-scoped CRUD hook used by every module page. Reads are auto-filtered
// by org_id; inserts auto-stamp org_id so RLS write checks pass.
export function useTable(table, { select: selectOpt = '*', order = { column: 'created_at', ascending: false } } = {}) {
  // employees has column-level read grants (private HR fields are hidden), so
  // '*' would be rejected — default to the readable directory columns.
  const select = table === 'employees' && selectOpt === '*' ? EMP_PUBLIC_SELECT : selectOpt
  const { activeOrgId } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!activeOrgId) { setRows([]); setLoading(false); return }
    setLoading(true)
    let q = supabase.from(table).select(select).eq('org_id', activeOrgId)
    if (order) q = q.order(order.column, { ascending: order.ascending })
    const { data, error } = await q
    if (error) setError(error); else { setRows(data || []); setError(null) }
    setLoading(false)
  }, [table, select, activeOrgId, order?.column, order?.ascending])

  useEffect(() => { refresh() }, [refresh])

  const insert = useCallback(async (payload) => {
    const body = Array.isArray(payload)
      ? payload.map((p) => ({ ...p, org_id: activeOrgId }))
      : { ...payload, org_id: activeOrgId }
    const { data, error } = await supabase.from(table).insert(body).select(select)
    if (error) throw error
    await refresh()
    return data
  }, [table, select, activeOrgId, refresh])

  const update = useCallback(async (id, patch) => {
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('org_id', activeOrgId).select(select)
    if (error) throw error
    await refresh()
    return data
  }, [table, select, activeOrgId, refresh])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('org_id', activeOrgId)
    if (error) throw error
    await refresh()
  }, [table, activeOrgId, refresh])

  return { rows, loading, error, refresh, insert, update, remove }
}
