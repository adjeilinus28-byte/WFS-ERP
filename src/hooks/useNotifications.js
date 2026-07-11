import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Reads the derived notifications_feed for the active org, subtracts the user's
// dismissals, and exposes unread count + dismiss/dismissAll. Polls every 60s
// (the feed is computed live from source tables; no realtime channel needed).
export function useNotifications() {
  const { activeOrgId, user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!activeOrgId) { setItems([]); setLoading(false); return }
    try {
      const [{ data: feed }, { data: dismissed }] = await Promise.all([
        supabase.from('notifications_feed').select('*').eq('org_id', activeOrgId),
        supabase.from('notification_dismissals').select('ref_id').eq('org_id', activeOrgId),
      ])
      const seen = new Set((dismissed || []).map((d) => d.ref_id))
      const rows = (feed || [])
        .filter((r) => !seen.has(r.ref_id))
        .sort((a, b) => {
          // bad first, then warn, then by recency
          const rank = { bad: 0, warn: 1, info: 2 }
          const s = (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)
          return s !== 0 ? s : new Date(b.created_at) - new Date(a.created_at)
        })
      setItems(rows)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [activeOrgId])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])

  const dismiss = useCallback(async (ref_id) => {
    setItems((x) => x.filter((i) => i.ref_id !== ref_id))   // optimistic
    await supabase.from('notification_dismissals').upsert(
      { org_id: activeOrgId, user_id: user?.id, ref_id }, { onConflict: 'org_id,user_id,ref_id' }
    )
  }, [activeOrgId, user])

  const dismissAll = useCallback(async () => {
    const refs = items.map((i) => i.ref_id)
    if (!refs.length) return
    setItems([])
    await supabase.from('notification_dismissals').upsert(
      refs.map((ref_id) => ({ org_id: activeOrgId, user_id: user?.id, ref_id })), { onConflict: 'org_id,user_id,ref_id' }
    )
  }, [items, activeOrgId, user])

  return { items, count: items.length, loading, reload: load, dismiss, dismissAll }
}
