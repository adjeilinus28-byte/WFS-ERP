import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Loads the active tenant's department list. `options` is ready to drop into a
// Select field (value = department name, for backward-compat with stored rows).
export function useDepartments() {
  const { activeOrgId } = useAuth()
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!activeOrgId) { setDepartments([]); setLoading(false); return }
    const { data } = await supabase.from('departments').select('*').eq('org_id', activeOrgId).order('name')
    setDepartments(data || [])
    setLoading(false)
  }, [activeOrgId])

  useEffect(() => { refresh() }, [refresh])

  const options = departments.map((d) => ({ value: d.name, label: d.name }))
  return { departments, options, loading, refresh }
}
