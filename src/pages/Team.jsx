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
const DOMAINS = ['operations', 'people', 'finance', 'safety', 'admin']
const LEVELS = ['none', 'view', 'edit', 'manage']

export default function Team() {
  const { activeOrgId, role, user } = useAuth()
  const toast = useToast()
  const canAdmin = ['owner', 'admin'].includes(role)
  const [members, setMembers] = useState([])
  const [perms, setPerms] = useState({})     // { user_id: { domain: level } }
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
      const [{ data: m }, { data: p }] = await Promise.all([
        supabase.from('org_members').select('user_id, full_name, email, role, department').eq('org_id', activeOrgId),
        supabase.from('member_permissions').select('user_id, domain, level').eq('org_id', activeOrgId),
      ])
      setMembers(m || [])
      const pm = {}
      for (const row of p || []) { (pm[row.user_id] ||= {})[row.domain] = row.level }
      setPerms(pm)
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
