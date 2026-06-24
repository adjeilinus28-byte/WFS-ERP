import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

const ACTIVE_ORG_KEY = 'wfs.activeOrg'

export function AuthProvider({ children }) {
  const [session, setSession]   = useState(null)
  const [memberships, setMems]  = useState([])     // rows from my_memberships()
  const [activeOrgId, setActive] = useState(() => localStorage.getItem(ACTIVE_ORG_KEY) || null)
  const [loading, setLoading]   = useState(true)
  const [membLoaded, setMembLoaded] = useState(false)
  const mounted = useRef(true)

  // Load membership via the SECURITY DEFINER RPC. NEVER awaited inside the
  // onAuthStateChange callback — that holds the auth lock and deadlocks every
  // subsequent Supabase request. We defer the call instead.
  const loadMemberships = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_memberships')
    if (!mounted.current) return
    if (error) { console.error('[WFS] my_memberships failed', error); setMems([]) }
    else {
      setMems(data || [])
      setActive((prev) => {
        if (prev && (data || []).some((m) => m.org_id === prev)) return prev
        const first = data?.[0]?.org_id || null
        if (first) localStorage.setItem(ACTIVE_ORG_KEY, first)
        return first
      })
    }
    setMembLoaded(true)
  }, [])

  useEffect(() => {
    mounted.current = true
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      if (data.session) setTimeout(loadMemberships, 0)
      else setMembLoaded(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess)
      // DEFER — do not await Supabase calls here (deadlock).
      if (sess) { setMembLoaded(false); setTimeout(loadMemberships, 0) }
      else { setMems([]); setActive(null); setMembLoaded(true) }
    })

    return () => { mounted.current = false; sub.subscription.unsubscribe() }
  }, [loadMemberships])

  const switchOrg = useCallback((orgId) => {
    localStorage.setItem(ACTIVE_ORG_KEY, orgId)
    setActive(orgId)
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(ACTIVE_ORG_KEY)
  }, [])

  const activeOrg = memberships.find((m) => m.org_id === activeOrgId) || null

  const value = {
    session, user: session?.user || null,
    memberships, activeOrg, activeOrgId,
    role: activeOrg?.role || null,
    isOwner: memberships[0]?.is_owner || false,
    loading, membLoaded,
    switchOrg, signOut, reloadMemberships: loadMemberships,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
