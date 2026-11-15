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
  const userIdRef = useRef(null)   // who the loaded memberships belong to

  // Load membership via the SECURITY DEFINER RPC. NEVER awaited inside the
  // onAuthStateChange callback — that holds the auth lock and deadlocks every
  // subsequent Supabase request. We defer the call instead.
  const loadMemberships = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_memberships')
    if (!mounted.current) return
    // On a failed refresh (e.g. a network blip) keep what we already have rather
    // than dropping the user out of their workspace.
    if (error) { console.error('[WFS] my_memberships failed', error); setMems((prev) => prev) }
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
      userIdRef.current = data.session?.user?.id || null
      setLoading(false)
      if (data.session) setTimeout(loadMemberships, 0)
      else setMembLoaded(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((evt, sess) => {
      setSession(sess)
      // DEFER — do not await Supabase calls here (deadlock).
      if (sess) {
        // Supabase re-fires SIGNED_IN whenever the tab regains focus and
        // TOKEN_REFRESHED about hourly. For the SAME user those must not drop
        // the app back to the "Loading workspace" splash — that unmounts every
        // page and discards open forms. Only a new/different user gets the splash.
        const sameUser = userIdRef.current && userIdRef.current === sess.user?.id
        userIdRef.current = sess.user?.id || null
        if (!sameUser) { setMembLoaded(false); setTimeout(loadMemberships, 0) }
        else if (evt === 'USER_UPDATED') setTimeout(loadMemberships, 0)   // silent refresh
      } else { userIdRef.current = null; setMems([]); setActive(null); setMembLoaded(true) }
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
