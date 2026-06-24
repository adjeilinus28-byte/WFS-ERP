import { useEffect } from 'react'
import { useAuth } from './AuthContext'
import { hexToRgbTriplet } from '../lib/format'

// Applies the active tenant's accent colour to the --accent CSS variable.
// White-label: navy chrome stays fixed, accent re-themes the whole UI.
export function ThemeApplier() {
  const { activeOrg } = useAuth()
  useEffect(() => {
    const hex = activeOrg?.accent_color || '#F59E0B'
    document.documentElement.style.setProperty('--accent', hexToRgbTriplet(hex))
  }, [activeOrg?.accent_color])
  return null
}
