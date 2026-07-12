import {
  LayoutDashboard, Wrench, Boxes, ShoppingCart, ClipboardList,
  Users, ShieldAlert, BarChart3, Settings as SettingsIcon,
  UserCog, Landmark, PackageMinus, Megaphone, Shirt, UtensilsCrossed, HeartHandshake, CalendarClock, GraduationCap, Scale, ClipboardCheck, UsersRound } from 'lucide-react'

export const MODULES = [
  { key: 'dashboard',   label: 'Command Deck', icon: LayoutDashboard, path: '/',            section: 'Overview' },
  { key: 'news',        label: 'News Flash',     icon: Megaphone,       path: '/news',        section: 'Overview' },
  { key: 'approvals',   label: 'Approvals',     icon: ClipboardCheck,  path: '/approvals',   section: 'Overview' },
  { key: 'assets',      label: 'Assets',        icon: Wrench,          path: '/assets',      section: 'Operations' },
  { key: 'work_orders', label: 'Work Orders',   icon: ClipboardList,   path: '/work-orders', section: 'Operations' },
  { key: 'inventory',   label: 'Inventory',     icon: Boxes,           path: '/inventory',   section: 'Supply Chain' },
  { key: 'procurement', label: 'Procurement',   icon: ShoppingCart,    path: '/procurement', section: 'Supply Chain' },
  { key: 'issuance',    label: 'Issuance',      icon: PackageMinus,    path: '/issuance',    section: 'Supply Chain' },
  { key: 'ppe',         label: 'PPE Planning',  icon: Shirt,           path: '/ppe',         section: 'Supply Chain' },
  { key: 'workforce',   label: 'Workforce',     icon: Users,           path: '/workforce',   section: 'People' },
  { key: 'shifts',      label: 'Shifts',        icon: CalendarClock,   path: '/shifts',      section: 'People' },
  { key: 'hr',          label: 'Leave',         icon: UserCog,         path: '/hr',          section: 'People' },
  { key: 'catering',    label: 'Catering',      icon: UtensilsCrossed, path: '/catering',    section: 'People' },
  { key: 'ir',          label: 'Relations',     icon: HeartHandshake,  path: '/relations',   section: 'People' },
  { key: 'financials',  label: 'Financials',    icon: Scale,           path: '/financials',  section: 'Finance' },
  { key: 'accounts',    label: 'Accounts',      icon: Landmark,        path: '/accounts',    section: 'Finance' },
  { key: 'training',    label: 'Training',      icon: GraduationCap,   path: '/training',    section: 'Compliance' },
  { key: 'hse',         label: 'HSE & Safety',  icon: ShieldAlert,     path: '/hse',         section: 'Compliance' },
  { key: 'reports',     label: 'Reports',       icon: BarChart3,       path: '/reports',     section: 'Insight' },
  { key: 'team',        label: 'Team & access', icon: UsersRound,      path: '/team',        section: 'Settings' },
  { key: 'settings',    label: 'Settings',      icon: SettingsIcon,    path: '/settings',    section: 'Admin' },
]

export const INDUSTRY_PRESETS = {
  mining:        ['dashboard','news','approvals','assets','work_orders','inventory','procurement','issuance','ppe','workforce','shifts','hr','catering','ir','accounts','financials','hse','training','reports','settings'],
  oil_gas:       ['dashboard','news','approvals','assets','work_orders','inventory','procurement','issuance','ppe','workforce','shifts','hr','catering','ir','accounts','financials','hse','training','reports','settings'],
  manufacturing: ['dashboard','news','approvals','assets','work_orders','inventory','procurement','issuance','ppe','workforce','shifts','hr','catering','ir','accounts','financials','reports','settings'],
  logistics:     ['dashboard','news','approvals','assets','work_orders','inventory','issuance','ppe','workforce','shifts','hr','catering','ir','accounts','financials','reports','settings'],
  general:       ['dashboard','news','approvals','assets','inventory','workforce','shifts','hr','catering','ir','accounts','financials','reports','settings'],
}

export const moduleByKey = Object.fromEntries(MODULES.map((m) => [m.key, m]))

export const ALWAYS_ON = new Set(['settings', 'dashboard'])

export function visibleModules(enabled = []) {
  const set = new Set([...enabled, ...ALWAYS_ON])
  return MODULES.filter((m) => set.has(m.key))
}
