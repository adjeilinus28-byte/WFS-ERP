// ============================================================================
//  Module registry — the heart of the "one-size-fits-all" design.
//  Every ERP capability is declared here once. Navigation, routing, and the
//  per-tenant module toggles in Settings all read from this list.
//
//  To add a module: build a page in src/pages, import it in App.jsx, add an
//  entry here, and (optionally) a table set in a new SQL migration. Nothing
//  else needs to change — nav and routes pick it up automatically.
// ============================================================================
import {
  LayoutDashboard, Wrench, Boxes, ShoppingCart, ClipboardList,
  Users, ShieldAlert, BarChart3, Settings as SettingsIcon,
} from 'lucide-react'

export const MODULES = [
  { key: 'dashboard',   label: 'Command Deck', icon: LayoutDashboard, path: '/',            section: 'Overview' },
  { key: 'assets',      label: 'Assets',        icon: Wrench,          path: '/assets',      section: 'Operations' },
  { key: 'work_orders', label: 'Work Orders',   icon: ClipboardList,   path: '/work-orders', section: 'Operations' },
  { key: 'inventory',   label: 'Inventory',     icon: Boxes,           path: '/inventory',   section: 'Supply Chain' },
  { key: 'procurement', label: 'Procurement',   icon: ShoppingCart,    path: '/procurement', section: 'Supply Chain' },
  { key: 'workforce',   label: 'Workforce',     icon: Users,           path: '/workforce',   section: 'People' },
  { key: 'hse',         label: 'HSE & Safety',  icon: ShieldAlert,     path: '/hse',         section: 'Compliance' },
  { key: 'reports',     label: 'Reports',       icon: BarChart3,       path: '/reports',     section: 'Insight' },
  { key: 'settings',    label: 'Settings',      icon: SettingsIcon,    path: '/settings',    section: 'Admin' },
]

// Industry presets — which modules light up by default when a tenant is created.
export const INDUSTRY_PRESETS = {
  mining:        ['dashboard','assets','work_orders','inventory','procurement','workforce','hse','reports','settings'],
  oil_gas:       ['dashboard','assets','work_orders','inventory','procurement','workforce','hse','reports','settings'],
  manufacturing: ['dashboard','assets','work_orders','inventory','procurement','workforce','reports','settings'],
  logistics:     ['dashboard','assets','work_orders','inventory','workforce','reports','settings'],
  general:       ['dashboard','assets','inventory','workforce','reports','settings'],
}

export const moduleByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]))

// Module always available regardless of enabled list (you can never lock
// yourself out of Settings).
export const ALWAYS_ON = new Set(['settings', 'dashboard'])

export function visibleModules(enabled = []) {
  const set = new Set([...enabled, ...ALWAYS_ON])
  return MODULES.filter((m) => set.has(m.key))
}
