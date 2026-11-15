import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu, X, ChevronDown, LogOut, Building2, Sun, Moon, Languages, Search, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import { LANGS } from '../i18n'
import CommandPalette from './CommandPalette'
import NotificationBell from './NotificationBell'
import SubChip from './SubChip'
import { WFSMark } from './Brand'
import { visibleModules } from '../lib/modules'
import { usePermissions } from '../hooks/usePermissions'
import { initials } from '../lib/format'



// Cycles through available languages; persisted by i18next's localStorage cache.
function LangSwitcher() {
  const { i18n, t } = useTranslation()
  const cur = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2)
  const next = () => {
    const idx = LANGS.findIndex((l) => l.code === cur)
    i18n.changeLanguage(LANGS[(idx + 1) % LANGS.length].code)
  }
  return (
    <button onClick={next} className="icon-btn !w-auto grid-flow-col gap-1 px-2.5"
      title={t('common.change_language')} aria-label={t('common.change_language')}>
      <Languages size={16} />
      <span className="font-mono text-[10px] font-bold uppercase">{cur}</span>
    </button>
  )
}

// Light/dark theme toggle — persists to localStorage, applied pre-paint by index.html.
function ThemeToggle() {
  const { t: tt } = useTranslation()
  const [light, setLight] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('light'))
  const flip = () => {
    const next = !light
    document.documentElement.classList.toggle('light', next)
    try { localStorage.setItem('wfs-theme', next ? 'light' : 'dark') } catch { /* private mode */ }
    setLight(next)
  }
  return (
    <button onClick={flip} className="icon-btn"
      title={light ? tt('common.theme_to_dark') : tt('common.theme_to_light')}
      aria-label={light ? tt('common.theme_to_dark') : tt('common.theme_to_light')}>
      {light ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  )
}

function Logo() {
  return <WFSMark size={36} className="h-9 w-9 shrink-0" />
}

// The tenant's own logo, shown in the organization chip beside its name. Falls
// back to the generic building icon when no logo has been uploaded.
function OrgMark({ logoUrl, name }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={name || 'Logo'} className="h-8 w-8 shrink-0 rounded-[9px] object-contain" />
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-accent-soft font-mono text-xs font-bold text-accent">
      {name ? initials(name) : <Building2 size={15} />}
    </span>
  )
}

export default function AppShell({ children }) {
  const { activeOrg, memberships, switchOrg, signOut, user, role, isOwner } = useAuth()
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)       // mobile nav
  const [orgMenu, setOrgMenu] = useState(false)
  const loc = useLocation()

  const { pageVisible } = usePermissions()
  const mods = visibleModules(activeOrg?.enabled_modules || []).filter((m) => pageVisible(m.key))
  const sections = [...new Set(mods.map((m) => m.section))]

  const secKey = (sec) => 'section.' + sec.toLowerCase().replace(/\s+/g, '_')

  const Nav = () => (
    <nav aria-label="Main navigation" className="flex-1 space-y-4 overflow-y-auto px-4 py-2">
      {sections.map((sec) => (
        <div key={sec}>
          <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ice-faint/70">{t(secKey(sec), sec)}</div>
          <div className="space-y-0.5">
            {mods.filter((m) => m.section === sec).map((m) => {
              const Icon = m.icon
              return (
                <NavLink key={m.key} to={m.path} end={m.path === '/'} onClick={() => setOpen(false)}
                  className={({ isActive }) => `group nav-item ${isActive ? 'nav-item-active' : ''}`}>
                  {({ isActive }) => (
                    <>
                      <Icon size={18} className={isActive ? 'text-accent' : 'text-ice-faint group-hover:text-ice-dim'} />
                      <span>{t(`nav.${m.key}`, m.label)}</span>
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}

      {isOwner && (
        <div>
          <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ice-faint/70">{t('section.platform', 'Platform')}</div>
          <div className="space-y-0.5">
            <NavLink to="/admin" onClick={() => setOpen(false)}
              className={({ isActive }) => `group nav-item ${isActive ? 'nav-item-active' : ''}`}>
              {({ isActive }) => (
                <>
                  <ShieldCheck size={18} className={isActive ? 'text-accent' : 'text-ice-faint group-hover:text-ice-dim'} />
                  <span>{t('nav.admin', 'Admin console')}</span>
                </>
              )}
            </NavLink>
          </div>
        </div>
      )}
    </nav>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <a href="#main" className="skip-link">{t('common.skip_to_content')}</a>
      <CommandPalette />
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-white/[0.06] bg-navy-900/85 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-6 pb-4 pt-5">
          <Logo />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-display text-[15px] font-extrabold tracking-tight text-ice">WFS Enterprise</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ice-faint">Operations Platform</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label={t('common.close')}><X size={18} className="text-ice-faint" /></button>
        </div>
        <Nav />

        {/* Workspace card — doubles as the organization switcher */}
        <div className="relative px-4 pb-3 pt-2">
          {orgMenu && memberships.length > 1 && (
            <div className="absolute bottom-full left-4 right-4 z-50 mb-1 rounded-xl border border-white/10 bg-navy-700 p-1 shadow-pop">
              {memberships.map((m) => (
                <button key={m.org_id}
                  onClick={() => { switchOrg(m.org_id); setOrgMenu(false) }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white/[0.05] ${m.org_id === activeOrg?.org_id ? 'text-accent' : 'text-ice-dim'}`}>
                  <span className="truncate">{m.org_name}</span>
                  <span className="ml-2 font-mono text-[10px] uppercase text-ice-faint">{m.role}</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setOrgMenu((v) => !v)} aria-haspopup={memberships.length > 1 ? 'menu' : undefined} aria-expanded={orgMenu}
            className={`flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-left transition ${memberships.length > 1 ? 'hover:border-white/[0.12] hover:bg-white/[0.06]' : 'cursor-default'}`}>
            <OrgMark logoUrl={activeOrg?.logo_url} name={activeOrg?.org_name} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold text-ice">{activeOrg?.org_name || 'No organization'}</span>
              <span className="block truncate text-[11px] capitalize text-ice-faint">
                {[activeOrg?.industry?.replace('_', ' '), role].filter(Boolean).join(' · ')}
              </span>
            </span>
            {memberships.length > 1 && <ChevronDown size={14} className={`shrink-0 text-ice-faint transition ${orgMenu ? '' : 'rotate-180'}`} />}
          </button>
          <a href="https://workflow-app.net" target="_blank" rel="noreferrer"
            className="mt-2.5 block px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ice-faint/70 hover:text-accent">
            Powered by WorkFlow Solutions
          </a>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-navy/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2.5 px-4 pb-2 pt-4 lg:px-8 lg:pt-5">
          <button className="icon-btn lg:hidden" onClick={() => setOpen(true)} aria-label={t('common.open_menu')}><Menu size={18} /></button>

          {/* Search — opens the command palette */}
          <button onClick={() => window.dispatchEvent(new CustomEvent('wfs:open-palette'))}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3.5 text-left text-sm text-ice-faint transition hover:border-white/[0.14] hover:bg-white/[0.06] sm:max-w-sm"
            aria-label={t('common.search')} title={t('common.search')}>
            <Search size={16} className="shrink-0" />
            <span className="flex-1 truncate">{t('common.search')}</span>
            <kbd className="hidden rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-ice-faint sm:block">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <SubChip />
            <NotificationBell />
            <span className="hidden sm:contents"><LangSwitcher /></span>
            <ThemeToggle />
            <div className="flex h-10 items-center gap-2.5 rounded-full border border-white/[0.07] bg-white/[0.04] pl-1.5 pr-1.5 sm:pr-3" title={user?.email}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent font-mono text-[11px] font-bold text-navy">
                {initials(user?.email?.split('@')[0] || 'U')}
              </span>
              <span className="hidden max-w-[140px] leading-tight sm:block">
                <span className="block truncate text-[13px] font-medium text-ice">{user?.email?.split('@')[0]}</span>
              </span>
            </div>
            <button onClick={signOut} aria-label={t('common.sign_out')} className="icon-btn" title={t('common.sign_out')}>
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main id="main" key={`${loc.pathname}:${i18n.resolvedLanguage || i18n.language}`} className="flex-1 overflow-y-auto px-4 pb-8 pt-4 lg:px-8 animate-fade-in">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
