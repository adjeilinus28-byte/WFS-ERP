import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, StatCard, Badge, EmptyState, useToast, Select } from '../components/ui'
import { at } from '../lib/tr'
import { Users, Shield, ChevronDown, Check, UserPlus, Copy, Mail } from 'lucide-react'

// Team & access management. Admins set each member's base role and, when needed,
// per-domain overrides (e.g. finance:manage for a supervisor). Writes go through
// the org_members / member_permissions RLS (owner/admin only), so this is gated
// both here and at the database.
const ROLES = ['owner', 'admin', 'manager', 'supervisor', 'operator', 'viewer']
const DOMAINS = ['operations', 'supply_chain', 'people', 'finance', 'compliance', 'approvals', 'insight', 'admin']

// Gateable pages (dashboard/news/settings are core → always visible, not listed).
// Each maps to the domain that auto-derives its visibility.
const PAGE_LIST = [
  ['approvals', 'approvals'], ['assets', 'operations'], ['work_orders', 'operations'],
  ['inventory', 'supply_chain'], ['procurement', 'supply_chain'], ['issuance', 'supply_chain'], ['ppe', 'supply_chain'],
  ['workforce', 'people'], ['shifts', 'people'], ['hr', 'people'], ['catering', 'people'], ['ir', 'people'],
  ['financials', 'finance'], ['accounts', 'finance'],
  ['hse', 'compliance'], ['training', 'compliance'],
  ['reports', 'insight'], ['team', 'admin'],
]
const PAGE_LABEL = {
  approvals: 'Approvals', assets: 'Assets', work_orders: 'Work Orders', inventory: 'Inventory',
  procurement: 'Procurement', issuance: 'Issuance', ppe: 'PPE Planning', workforce: 'Workforce',
  shifts: 'Shifts', hr: 'Leave', catering: 'Catering', ir: 'Relations', financials: 'Financials',
  accounts: 'Accounts', hse: 'HSE & Safety', training: 'Training', reports: 'Reports', team: 'Team & access',
}
const RANK = { none: 0, view: 1, edit: 2, manage: 3 }
const LEVELS = ['none', 'view', 'edit', 'manage']

export default function Team() {
  const { activeOrgId, role, user } = useAuth()
  const toast = useToast()
  const canAdmin = ['owner', 'admin'].includes(role)
  const [members, setMembers] = useState([])
  const [perms, setPerms] = useState({})     // { user_id: { domain: level } }
  const [pageOv, setPageOv] = useState({})   // { user_id: { module_key: 'show'|'hide' } }
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviteLink, setInviteLink] = useState('')
  const [inviting, setInviting] = useState(false)

  const sendInvite = async () => {
    if (!inviteEmail.trim()) { toast.error(at('Email is required')); return }
    setInviting(true); setInviteLink('')
    try {
      const { data: token, error } = await supabase.rpc('create_invite', {
        p_org: activeOrgId, p_email: inviteEmail.trim(), p_role: inviteRole,
      })
      if (error) throw error
      const link = `${window.location.origin}/invite/${token}`
      setInviteLink(link)
      // Fire the Brevo email (best-effort; link is shown regardless).
      try {
        await fetch('/.netlify/functions/send-invite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail.trim(), link, org: activeOrg?.org_name, role: inviteRole }),
        })
        toast.success(at('Invitation sent'))
      } catch { toast.success(at('Invite link created — copy it below')) }
      setInviteEmail('')
    } catch (e) { toast.error(e.message || 'Invite failed') }
    finally { setInviting(false) }
  }

  const copyLink = () => { navigator.clipboard?.writeText(inviteLink); toast.success(at('Link copied')) }

  const load = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    try {
      const [{ data: m }, { data: p }, { data: pov }] = await Promise.all([
        supabase.from('org_members').select('user_id, full_name, email, role, department').eq('org_id', activeOrgId),
        supabase.from('member_permissions').select('user_id, domain, level').eq('org_id', activeOrgId),
        supabase.from('member_page_overrides').select('user_id, module_key, mode').eq('org_id', activeOrgId),
      ])
      setMembers(m || [])
      const pm = {}
      for (const row of p || []) { (pm[row.user_id] ||= {})[row.domain] = row.level }
      setPerms(pm)
      const om = {}
      for (const row of pov || []) { (om[row.user_id] ||= {})[row.module_key] = row.mode }
      setPageOv(om)
    } catch (e) { toast.error(e.message || 'Load failed') }
    finally { setLoading(false) }
  }, [activeOrgId, toast])

  useEffect(() => { load() }, [load])

  const setRole = async (uid, newRole) => {
    try {
      const { error } = await supabase.from('org_members').update({ role: newRole })
        .eq('org_id', activeOrgId).eq('user_id', uid)
      if (error) throw error
      setMembers((x) => x.map((m) => m.user_id === uid ? { ...m, role: newRole } : m))
      toast.success(at('Role updated'))
    } catch (e) { toast.error(e.message || 'Update failed') }
  }

  const setOverride = async (uid, domain, level) => {
    try {
      // level '' means "clear override" (fall back to base role)
      if (!level) {
        const { error } = await supabase.from('member_permissions').delete()
          .eq('org_id', activeOrgId).eq('user_id', uid).eq('domain', domain)
        if (error) throw error
        setPerms((x) => { const c = { ...(x[uid] || {}) }; delete c[domain]; return { ...x, [uid]: c } })
      } else {
        const { error } = await supabase.from('member_permissions')
          .upsert({ org_id: activeOrgId, user_id: uid, domain, level }, { onConflict: 'org_id,user_id,domain' })
        if (error) throw error
        setPerms((x) => ({ ...x, [uid]: { ...(x[uid] || {}), [domain]: level } }))
      }
      toast.success(at('Access updated'))
    } catch (e) { toast.error(e.message || 'Update failed') }
  }

  // Page visibility override: mode '' = auto (clear), 'show' or 'hide'.
  const setPageMode = async (uid, moduleKey, mode) => {
    try {
      const { error } = await supabase.rpc('set_page_override', {
        p_org: activeOrgId, p_user: uid, p_module: moduleKey, p_mode: mode || null,
      })
      if (error) throw error
      setPageOv((x) => {
        const c = { ...(x[uid] || {}) }
        if (!mode) delete c[moduleKey]; else c[moduleKey] = mode
        return { ...x, [uid]: c }
      })
      toast.success(at('Page access updated'))
    } catch (e) { toast.error(e.message || 'Update failed') }
  }

  const removeMember = async (uid, name, purge) => {
    const msg = purge
      ? `${at('Remove and purge')} ${name}? ${at('This revokes access and de-attributes their records. This cannot be undone.')}`
      : `${at('Remove')} ${name} ${at('from this organization? They lose access but their data is kept.')}`
    if (!window.confirm(msg)) return
    try {
      const { error } = await supabase.rpc('remove_member', { p_org: activeOrgId, p_user: uid, p_purge: purge })
      if (error) throw error
      setMembers((x) => x.filter((m) => m.user_id !== uid))
      setExpanded(null)
      toast.success(purge ? at('Member removed and purged') : at('Member removed'))
    } catch (e) { toast.error(e.message || 'Remove failed') }
  }

  const resetPassword = async (uid, email) => {
    if (!window.confirm(`${at('Send a password reset to')} ${email}?`)) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/reset-member-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ org_id: activeOrgId, target_user_id: uid, redirect_to: window.location.origin }),
      })
      if (!res.ok) throw new Error(await res.text())
      const out = await res.json()
      if (out.emailed) toast.success(at('Reset email sent'))
      else if (out.link) { await navigator.clipboard?.writeText(out.link); toast.success(at('Reset link copied to clipboard')) }
      else toast.success(at('Reset link generated'))
    } catch (e) { toast.error(e.message || 'Reset failed') }
  }

  // Derived auto-visibility for a member+page (mirrors the DB/hook resolver) so
  // the UI can show what 'Auto' resolves to and warn on contradictions.
  const autoVisible = (uid, moduleKey, domain) => {
    const m = members.find((x) => x.user_id === uid)
    if (m && ['owner', 'admin'].includes(m.role)) return true
    const lvl = perms[uid]?.[domain] // per-person override if any
    if (lvl) return RANK[lvl] >= 1
    return true // base-role default is >= view for most; treated as visible hint
  }

  if (!canAdmin) {
    return <div className="pt-10"><EmptyState title={at('No access')} hint={at('Only owners and admins can manage the team.')} /></div>
  }

  return (
    <div>
      <PageHeader eyebrow={at('Admin')} title={at('Team & access')} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={at('Members')} value={members.length} icon={Users} />
        <StatCard label={at('Admins')} value={members.filter((m) => ['owner', 'admin'].includes(m.role)).length} icon={Shield} tone="accent" />
        <StatCard label={at('With custom access')} value={Object.keys(perms).filter((u) => Object.keys(perms[u] || {}).length).length} icon={Check} />
      </div>

      {/* Invite a new member by email */}
      <div className="panel mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ice"><UserPlus size={16} className="text-accent" /> {at('Invite a member')}</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" type="email" placeholder={at('name@company.com')} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <div className="w-full sm:w-40">
            <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
              options={['admin','manager','supervisor','operator','viewer'].map((r) => ({ value: r, label: r }))} />
          </div>
          <button onClick={sendInvite} disabled={inviting} className="btn-primary shrink-0"><Mail size={15} /> {inviting ? at('Sending…') : at('Send invite')}</button>
        </div>
        {inviteLink && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ice-dim">{inviteLink}</span>
            <button onClick={copyLink} className="shrink-0 rounded-md bg-accent/15 px-2 py-1 text-xs text-accent hover:bg-accent/25"><Copy size={12} className="inline" /> {at('Copy')}</button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ice-faint">{at('The invitee signs in with this email to join. Links expire in 7 days.')}</p>
      </div>

      <RoleMatrix orgId={activeOrgId} />

      {loading ? <div className="panel p-8 text-center text-sm text-ice-faint">{at('Loading…')}</div>
      : members.length === 0 ? <EmptyState title={at('No members yet')} />
      : (
        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = m.user_id === user?.id
            const open = expanded === m.user_id
            const overrideCount = Object.keys(perms[m.user_id] || {}).length
            return (
              <div key={m.user_id} className="panel p-4">
                <div className="flex items-center gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 font-display text-sm font-bold text-accent">
                    {(m.full_name || m.email || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ice">{m.full_name || m.email}</div>
                    <div className="text-xs text-ice-faint">{m.email}{m.department ? ` · ${m.department}` : ''}{overrideCount ? ` · ${overrideCount} ${at('custom')}` : ''}</div>
                  </div>
                  {/* base role selector */}
                  <div className="w-40 shrink-0">
                    <Select value={m.role} onChange={(e) => setRole(m.user_id, e.target.value)}
                      disabled={isSelf && m.role === 'owner'}
                      options={ROLES.map((r) => ({ value: r, label: r }))} />
                  </div>
                  <button onClick={() => setExpanded(open ? null : m.user_id)}
                    className="shrink-0 rounded-lg bg-white/[0.05] p-2 text-ice-dim hover:text-ice" aria-label={at('Per-module access')}>
                    <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {open && (
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    <div className="mb-2 text-[11px] text-ice-faint">{at('Per-module access — leave as default to inherit the base role.')}</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {DOMAINS.map((d) => (
                        <div key={d} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-xs capitalize text-ice-dim">{at(d)}</span>
                          <Select value={perms[m.user_id]?.[d] || ''} onChange={(e) => setOverride(m.user_id, d, e.target.value)}
                            options={[{ value: '', label: at('Default') }, ...LEVELS.map((l) => ({ value: l, label: at(l) }))]} />
                        </div>
                      ))}
                    </div>

                    <div className="mb-2 mt-4 text-[11px] text-ice-faint">
                      {at('Pages — Auto shows a page when their access allows it. Force show or hide to override.')}
                      {m.role === 'owner' && (
                        <span className="ml-1 text-warn">{at('Owners always see all pages — these settings have no effect.')}</span>
                      )}
                    </div>
                    <div className={`grid gap-1.5 sm:grid-cols-2 ${m.role === 'owner' ? 'opacity-50' : ''}`}>
                      {PAGE_LIST.map(([key, dom]) => {
                        const mode = pageOv[m.user_id]?.[key] || ''
                        const auto = autoVisible(m.user_id, key, dom)
                        const contradiction = mode === 'show' && !auto
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 text-xs text-ice-dim">
                              {at(PAGE_LABEL[key])}
                              {contradiction && <span className="ml-1 text-warn" title={at('Shown but they may not have data access')}>⚠</span>}
                            </span>
                            <div className="flex-1">
                              <Select value={mode} onChange={(e) => setPageMode(m.user_id, key, e.target.value)}
                                options={[
                                  { value: '', label: `${at('Auto')} (${auto ? at('shown') : at('hidden')})` },
                                  { value: 'show', label: at('Show') },
                                  { value: 'hide', label: at('Hide') },
                                ]} />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {m.role !== 'owner' && !isSelf && (
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                        <span className="text-[11px] text-ice-faint">{at('Member actions')}:</span>
                        <button onClick={() => resetPassword(m.user_id, m.email)}
                          className="rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-ice-dim hover:text-ice">
                          {at('Send password reset')}
                        </button>
                        <button onClick={() => removeMember(m.user_id, m.full_name || m.email, false)}
                          className="rounded-lg bg-warn/15 px-3 py-1.5 text-xs text-warn hover:bg-warn/25">
                          {at('Remove from org')}
                        </button>
                        <button onClick={() => removeMember(m.user_id, m.full_name || m.email, true)}
                          className="rounded-lg bg-bad/15 px-3 py-1.5 text-xs text-bad hover:bg-bad/25">
                          {at('Remove & purge')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Org-configurable permission matrix: redefine what each access tier gets by
// default in each domain, for THIS org. Empty cells = built-in default. A
// per-person override (set on a member above) still beats these org defaults.
const RM_ROLES = ['admin', 'manager', 'supervisor', 'operator', 'viewer']
const RM_DOMAINS = ['operations', 'supply_chain', 'people', 'finance', 'compliance', 'approvals', 'insight', 'admin']
const RM_LEVELS = ['none', 'view', 'edit', 'manage']

function RoleMatrix({ orgId }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [cells, setCells] = useState({})    // { 'role:domain': { level, is_custom } }
  const [scopes, setScopes] = useState({})  // { role: 'all'|'own_edit'|'own_only' }
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [{ data }, { data: sc }] = await Promise.all([
        supabase.rpc('org_role_matrix', { p_org: orgId }),
        supabase.rpc('org_dept_scopes', { p_org: orgId }),
      ])
      const map = {}
      for (const r of data || []) map[`${r.role}:${r.domain}`] = { level: r.level, is_custom: r.is_custom }
      setCells(map)
      const sm = {}
      for (const r of sc || []) sm[r.role] = r.scope
      setScopes(sm)
    } catch (e) { toast.error(e.message || 'Load failed') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open) load() }, [open, orgId])

  const setCell = async (role, domain, level) => {
    // level '' clears the override (revert to built-in default)
    try {
      const { error } = await supabase.rpc('set_role_default', {
        p_org: orgId, p_role: role, p_domain: domain, p_level: level || null,
      })
      if (error) throw error
      await load()
      toast.success(at('Role defaults updated'))
    } catch (e) { toast.error(e.message || 'Update failed') }
  }

  const setScope = async (role, scope) => {
    try {
      const { error } = await supabase.rpc('set_dept_scope', { p_org: orgId, p_role: role, p_scope: scope })
      if (error) throw error
      setScopes((x) => ({ ...x, [role]: scope }))
      toast.success(at('Department scope updated'))
    } catch (e) { toast.error(e.message || 'Update failed') }
  }

  return (
    <div className="panel mb-6 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-ice">
          <Shield size={16} className="text-accent" /> {at('Role permission defaults')}
        </span>
        <ChevronDown size={16} className={`text-ice-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-white/[0.06] p-5">
          <p className="mb-4 text-[11px] text-ice-faint">
            {at('Set what each role can do by default in this organization. Blank inherits the built-in default. Per-person overrides still win.')}
          </p>
          {loading ? <div className="py-6 text-center text-sm text-ice-faint">{at('Loading…')}</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 pr-3 font-mono text-[10px] uppercase tracking-wider text-ice-faint">{at('Role')}</th>
                    {RM_DOMAINS.map((d) => (
                      <th key={d} className="pb-2 px-2 font-mono text-[10px] uppercase tracking-wider text-ice-faint">{at(d)}</th>
                    ))}
                    <th className="pb-2 px-2 font-mono text-[10px] uppercase tracking-wider text-accent">{at('Department')}</th>
                  </tr>
                </thead>
                <tbody>
                  {RM_ROLES.map((r) => (
                    <tr key={r} className="border-t border-white/[0.05]">
                      <td className="py-2 pr-3 text-ice-dim capitalize">{at(r)}</td>
                      {RM_DOMAINS.map((d) => {
                        const cell = cells[`${r}:${d}`] || {}
                        return (
                          <td key={d} className="px-2 py-2">
                            <select
                              value={cell.is_custom ? cell.level : ''}
                              onChange={(e) => setCell(r, d, e.target.value)}
                              className={`w-full rounded-md border px-2 py-1 text-xs ${cell.is_custom ? 'border-accent/40 bg-accent/10 text-ice' : 'border-white/10 bg-white/[0.03] text-ice-dim'}`}>
                              <option value="" className="bg-navy-700">{at('Default')} ({at(cell.level || 'none')})</option>
                              {RM_LEVELS.map((l) => <option key={l} value={l} className="bg-navy-700">{at(l)}</option>)}
                            </select>
                          </td>
                        )
                      })}
                      <td className="px-2 py-2">
                        <select value={scopes[r] || 'all'} onChange={(e) => setScope(r, e.target.value)}
                          className={`w-full rounded-md border px-2 py-1 text-xs ${(scopes[r] && scopes[r] !== 'all') ? 'border-accent/40 bg-accent/10 text-ice' : 'border-white/10 bg-white/[0.03] text-ice-dim'}`}>
                          <option value="all" className="bg-navy-700">{at('All departments')}</option>
                          <option value="own_edit" className="bg-navy-700">{at('See all, edit own')}</option>
                          <option value="own_only" className="bg-navy-700">{at('Own department only')}</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-warn">{at('Note: changing the Admin row affects all admins, including you. Owners are always full-access.')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
