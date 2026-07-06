import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader, Field, Select, useToast, Badge } from '../components/ui'
import { MODULES, ALWAYS_ON } from '../lib/modules'
import { Check } from 'lucide-react'

const INDUSTRIES = [
  { value: 'mining', label: 'Mining' },
  { value: 'oil_gas', label: 'Oil & Gas' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'general', label: 'General' },
]
const SWATCHES = ['#F59E0B', '#38BDF8', '#34D399', '#F472B6', '#A78BFA', '#FB7185', '#FACC15']

export default function Settings() {
  const { activeOrg, activeOrgId, role, reloadMemberships } = useAuth()
  const toast = useToast()
  const canAdmin = ['owner', 'admin'].includes(role)

  const [form, setForm] = useState({})
  const [modules, setModules] = useState([])
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!activeOrg) return
    setForm({
      name: activeOrg.org_name, accent_color: activeOrg.accent_color,
      currency: activeOrg.currency, industry: activeOrg.industry,
      contact_email: activeOrg.contact_email || '',
      hse_head_email: activeOrg.hse_head_email || '',
      ops_head_email: activeOrg.ops_head_email || '',
      iro_email: activeOrg.iro_email || '',
      counsellor_email: activeOrg.counsellor_email || '',
      wellbeing_note: activeOrg.wellbeing_note || '',
    })
    setModules(activeOrg.enabled_modules || [])
  }, [activeOrgId])

  useEffect(() => {
    if (!activeOrgId) return
    supabase.from('org_members').select('user_id, full_name, email, role, department').eq('org_id', activeOrgId)
      .then(({ data }) => setMembers(data || []))
  }, [activeOrgId])

  const toggle = (key) => {
    if (ALWAYS_ON.has(key)) return
    setModules((m) => m.includes(key) ? m.filter((k) => k !== key) : [...m, key])
  }

  const save = async () => {
    setSaving(true)
    const patch = { ...form, enabled_modules: modules }
    const { error } = await supabase.rpc('update_org_profile', { p_org: activeOrgId, p_patch: patch })
    if (error) toast.error(error.message)
    else { toast.success('Settings saved'); await reloadMemberships() }
    setSaving(false)
  }

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Settings">
        {canAdmin && <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>}
      </PageHeader>

      {!canAdmin && (
        <div className="mb-6 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          You can view settings, but only owners and admins can change them.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Branding */}
        <div className="panel p-5">
          <div className="eyebrow mb-4">White-label branding</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Organization name" span>
              <input className="input" value={form.name || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Industry">
              <Select value={form.industry || 'general'} options={INDUSTRIES} disabled={!canAdmin} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            </Field>
            <Field label="Currency">
              <Select value={form.currency || 'GHS'} options={['GHS', 'USD', 'NGN', 'ZAR', 'EUR', 'GBP']} disabled={!canAdmin} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </Field>
            <Field label="Contact email" span>
              <input className="input" value={form.contact_email || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </Field>
            <Field label="Head of HSE email (incident alerts)" span>
              <input className="input" value={form.hse_head_email || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, hse_head_email: e.target.value })} placeholder="hse.head@company.com" />
            </Field>
            <Field label="Head of Operations email (incident alerts)" span>
              <input className="input" value={form.ops_head_email || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, ops_head_email: e.target.value })} placeholder="ops.head@company.com" />
            </Field>
            <Field label="Industrial Relations officer email" span>
              <input className="input" value={form.iro_email || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, iro_email: e.target.value })} placeholder="iro@company.com" />
            </Field>
            <Field label="Counsellor email" span>
              <input className="input" value={form.counsellor_email || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, counsellor_email: e.target.value })} placeholder="counsellor@company.com" />
            </Field>
            <Field label="Wellbeing / support note (shown to workers)" span>
              <textarea className="input min-h-[60px]" value={form.wellbeing_note || ''} disabled={!canAdmin} onChange={(e) => setForm({ ...form, wellbeing_note: e.target.value })} placeholder="e.g. Our Employee Assistance Programme is available 24/7 on ..." />
            </Field>
          </div>
          <div className="mt-4">
            <span className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">Accent colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} disabled={!canAdmin} onClick={() => setForm({ ...form, accent_color: c })}
                  className="h-9 w-9 rounded-lg border-2 transition"
                  style={{ background: c, borderColor: form.accent_color === c ? '#F1F5F9' : 'transparent' }} />
              ))}
              <input type="color" disabled={!canAdmin} value={form.accent_color || '#F59E0B'}
                onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent" />
            </div>
          </div>
        </div>

        {/* Modules */}
        <div className="panel p-5">
          <div className="eyebrow mb-1">Enabled modules</div>
          <p className="mb-4 text-xs text-ice-faint">Switch capabilities on or off for this workspace. Dashboard and Settings are always available.</p>
          <div className="space-y-1.5">
            {MODULES.map((m) => {
              const on = modules.includes(m.key) || ALWAYS_ON.has(m.key)
              const locked = ALWAYS_ON.has(m.key)
              const Icon = m.icon
              return (
                <button key={m.key} disabled={!canAdmin || locked} onClick={() => toggle(m.key)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${on ? 'border-accent-line bg-accent-soft' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                  <Icon size={16} className={on ? 'text-accent' : 'text-ice-faint'} />
                  <span className="flex-1 text-sm text-ice">{m.label}</span>
                  {locked && <span className="font-mono text-[10px] uppercase text-ice-faint">always on</span>}
                  <span className={`grid h-5 w-5 place-items-center rounded ${on ? 'bg-accent text-navy' : 'border border-white/15'}`}>
                    {on && <Check size={13} />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Members */}
        <div className="panel p-5 lg:col-span-2">
          <div className="eyebrow mb-4">Workspace members</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">Name</th><th className="th">Email</th><th className="th">Department</th><th className="th">Role</th>
              </tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td className="td">{m.full_name || '—'}</td>
                    <td className="td">{m.email || '—'}</td>
                    <td className="td">{m.department || '—'}</td>
                    <td className="td"><Badge tone="accent">{m.role}</Badge></td>
                  </tr>
                ))}
                {members.length === 0 && <tr><td className="td text-ice-faint" colSpan={4}>No other members visible.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
