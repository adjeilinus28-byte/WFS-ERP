import {
  LayoutDashboard, Wrench, Boxes, ShoppingCart, ClipboardList,
  Users, ShieldAlert, BarChart3, Settings as SettingsIcon,
  UserCog, Landmark, PackageMinus,
} from 'lucide-react'

export const MODULES = [
  { key: 'dashboard',   label: 'Command Deck', icon: LayoutDashboard, path: '/',            section: 'Overview' },
  { key: 'assets',      label: 'Assets',        icon: Wrench,          path: '/assets',      section: 'Operations' },
  { key: 'work_orders', label: 'Work Orders',   icon: ClipboardList,   path: '/work-orders', section: 'Operations' },
  { key: 'inventory',   label: 'Inventory',     icon: Boxes,           path: '/inventory',   section: 'Supply Chain' },
  { key: 'procurement', label: 'Procurement',   icon: ShoppingCart,    path: '/procurement', section: 'Supply Chain' },
  { key: 'issuance',    label: 'Issuance',      icon: PackageMinus,    path: '/issuance',    section: 'Supply Chain' },
  { key: 'workforce',   label: 'Workforce',     icon: Users,           path: '/workforce',   section: 'People' },
  { key: 'hr',          label: 'HR',            icon: UserCog,         path: '/hr',          section: 'People' },
  { key: 'accounts',    label: 'Accounts',      icon: Landmark,        path: '/accounts',    section: 'Finance' },
  { key: 'hse',         label: 'HSE & Safety',  icon: ShieldAlert,     path: '/hse',         section: 'Compliance' },
  { key: 'reports',     label: 'Reports',       icon: BarChart3,       path: '/reports',     section: 'Insight' },
  { key: 'settings',    label: 'Settings',      icon: SettingsIcon,    path: '/settings',    section: 'Admin' },
]

export const INDUSTRY_PRESETS = {
  mining:        ['dashboard','assets','work_orders','inventory','procurement','issuance','workforce','hr','accounts','hse','reports','settings'],
  oil_gas:       ['dashboard','assets','work_orders','inventory','procurement','issuance','workforce','hr','accounts','hse','reports','settings'],
  manufacturing: ['dashboard','assets','work_orders','inventory','procurement','issuance','workforce','hr','accounts','reports','settings'],
  logistics:     ['dashboard','assets','work_orders','inventory','issuance','workforce','hr','accounts','reports','settings'],
  general:       ['dashboard','assets','inventory','workforce','hr','accounts','reports','settings'],
}

export const moduleByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]))

export const ALWAYS_ON = new Set(['settings', 'dashboard'])

export function visibleModules(enabled = []) {
  const set = new Set([...enabled, ...ALWAYS_ON])
  return MODULES.filter((m) => set.has(m.key))
}
