import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Computes the active org's subscription state from fields now returned by
// my_memberships(), and loads platform pricing. No extra context needed — the
// activeOrg already carries the subscription columns after migration 0034.
export function useSubscription() {
  const { activeOrg, isOwner } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await supabase.from('platform_settings').select('*').eq('id', 1).single()
      setSettings(data || null)
    } catch { setSettings(null) } finally { setLoadingSettings(false) }
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  // Derive status from the active org.
  const now = new Date()
  const status = activeOrg?.subscription_status || 'trial'
  const trialEnds = activeOrg?.trial_ends_at ? new Date(activeOrg.trial_ends_at) : null
  const subEnds = activeOrg?.subscription_ends_at ? new Date(activeOrg.subscription_ends_at) : null

  const daysBetween = (d) => (d ? Math.ceil((d - now) / 86400000) : 0)

  let state = 'active', daysLeft = 0, isTrial = false
  if (status === 'comped') {
    state = 'active'
  } else if (status === 'active') {
    daysLeft = daysBetween(subEnds)
    state = daysLeft > 0 ? 'active' : 'expired'
  } else if (status === 'trial') {
    isTrial = true
    daysLeft = daysBetween(trialEnds)
    state = daysLeft > 0 ? 'trial' : 'expired'
  }

  // Platform owners (super-admins) are never gated.
  const gated = !isOwner && state === 'expired'

  return {
    settings, loadingSettings,
    state,                 // 'active' | 'trial' | 'expired'
    isTrial,
    daysLeft: Math.max(0, daysLeft),
    gated,
    reloadSettings: loadSettings,
  }
}
