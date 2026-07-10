import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu, X, ChevronDown, LogOut, Building2, Sun, Moon, Languages } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from 'react-i18next'
import { LANGS } from '../i18n'
import { visibleModules } from '../lib/modules'
import { initials } from '../lib/format'
import { Badge } from './ui'



// Cycles through available languages; persisted by i18next's localStorage cache.
function LangSwitcher() {
  const { i18n, t } = useTranslation()
  const cur = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2)
  const next = () => {
    const idx = LANGS.findIndex((l) => l.code === cur)
    i18n.changeLanguage(LANGS[(idx + 1) % LANGS.length].code)
  }
  return (
    <button onClick={next} className="flex items-center gap-1 rounded-lg p-2 text-ice-faint hover:bg-white/5 hover:text-ice"
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
    <button onClick={flip} className="rounded-lg p-2 text-ice-faint hover:bg-white/5 hover:text-ice"
      title={light ? tt('common.theme_to_dark') : tt('common.theme_to_light')}
      aria-label={light ? tt('common.theme_to_dark') : tt('common.theme_to_light')}>
      {light ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="h-7 w-7">
      <rect width="64" height="64" rx="14" fill="#0E1424" />
      <path d="M14 20 L24 44 L32 26 L40 44 L50 20" fill="none" stroke="rgb(var(--accent))"
        strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function AppShell({ children }) {
  const { activeOrg, memberships, switchOrg, signOut, user, role } = useAuth()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)       // mobile nav
  const [orgMenu, setOrgMenu] = useState(false)
  const loc = useLocation()

  const mods = visibleModules(activeOrg?.enabled_modules || [])
  const sections = [...new Set(mods.map((m) => m.section))]

  const secKey = (sec) => 'section.' + sec.toLowerCase().replace(/\s+/g, '_')

  const Nav = () => (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {sections.map((sec) => (
        <div key={sec}>
          <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ice-faint/70">{t(secKey(sec), sec)}</div>
          <div className="space-y-0.5">
            {mods.filter((m) => m.section === sec).map((m) => {
              const Icon = m.icon
              return (
                <NavLink key={m.key} to={m.path} end={m.path === '/'} onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition ${
                      isActive ? 'bg-accent-soft text-ice' : 'text-ice-dim hover:bg-white/[0.04] hover:text-ice'
                    }`}>
                  {({ isActive }) => (
                    <>
                      <Icon size={17} className={isActive ? 'text-accent' : 'text-ice-faint group-hover:text-ice-dim'} />
                      <span className="font-medium">{t(`nav.${m.key}`, m.label)}</span>
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <a href="#main" className="skip-link">{t('common.skip_to_content')}</a>
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/[0.06] bg-navy-800/80 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-4">
          <Logo />
          <div className="leading-tight">
            <div className="font-display text-sm font-extrabold tracking-tight text-ice">WFS Enterprise</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ice-faint">Operations Platform</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)}><X size={18} className="text-ice-faint" /></button>
        </div>
        <Nav />
        <div className="border-t border-white/[0.06] px-4 py-3">
          <a href="https://workflow-app.net" target="_blank" rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-wider text-ice-faint hover:text-accent">
            Powered by WorkFlow Solutions
          </a>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-navy/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-white/[0.06] bg-navy-800/40 px-4 py-3 backdrop-blur lg:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label={t('common.open_menu')}><Menu size={20} className="text-ice-dim" /></button>

          {/* Org switcher */}
          <div className="relative">
            <button onClick={() => setOrgMenu((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-navy/50 px-3 py-1.5 text-sm hover:bg-white/[0.04]">
              <Building2 size={15} className="text-accent" />
              <span className="font-semibold text-ice">{activeOrg?.org_name || 'No organization'}</span>
              {memberships.length > 1 && <ChevronDown size={14} className="text-ice-faint" />}
            </button>
            {orgMenu && memberships.length > 1 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-lg border border-white/10 bg-navy-700 p-1 shadow-pop">
                {memberships.map((m) => (
                  <button key={m.org_id}
                    onClick={() => { switchOrg(m.org_id); setOrgMenu(false) }}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-white/[0.05] ${m.org_id === activeOrg?.org_id ? 'text-accent' : 'text-ice-dim'}`}>
                    <span>{m.org_name}</span>
                    <span className="font-mono text-[10px] uppercase text-ice-faint">{m.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeOrg && <Badge tone="accent">{activeOrg.industry?.replace('_', ' ')}</Badge>}

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-ice">{user?.email}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-ice-faint">{role}</div>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft font-mono text-xs font-bold text-accent">
              {initials(user?.email?.split('@')[0] || 'U')}
            </div>
            <LangSwitcher />
            <ThemeToggle />
            <button onClick={signOut} aria-label={t('common.sign_out')} className="rounded-lg p-2 text-ice-faint hover:bg-white/5 hover:text-ice" title={t('common.sign_out')}>
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main id="main" key={loc.pathname} className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 animate-fade-in">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
