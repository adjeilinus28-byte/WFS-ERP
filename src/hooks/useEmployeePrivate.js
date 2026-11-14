import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Loads private HR fields (pay, bank, ID, personal) the caller is allowed to
// see — all employees for HR/finance managers, otherwise only their own record.
// merge(rows) overlays them onto directory rows from useTable('employees').
export function useEmployeePrivate() {
  const { activeOrgId } = useAuth()
  const [map, setMap] = useState({})

  const refresh = useCallback(async () => {
    if (!activeOrgId) { setMap({}); return }
    const { data, error } = await supabase.rpc('employee_private', { p_org: activeOrgId })
    if (error) { setMap({}); return }
    const m = {}
    for (const r of data || []) m[r.id] = r.data || {}
    setMap(m)
  }, [activeOrgId])

  useEffect(() => { refresh() }, [refresh])

  const merge = useCallback((rows) => rows.map((r) => (map[r.id] ? { ...r, ...map[r.id] } : r)), [map])

  return { privateById: map, merge, refresh }
}
