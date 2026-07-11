import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { at } from '../lib/tr'
import { WFSMark } from '../components/Brand'
import { ArrowRight, Building2 } from 'lucide-react'

// Shown to a signed-in user who has no organization yet. They create their own
// org here and become its owner; the DB starts a 30-day trial automatically.
// Existing invited users never reach this (they already have a membership).
const INDUSTRIES = [
  ['mining', 'Mining'], ['oil_gas', 'Oil & Gas'], ['manufacturing', 'Manufacturing'],
  ['logistics', 'Logistics'], ['general', 'General'],
]

export default function CreateOrg() {
  const { user, signOut, reloadMemberships } = useAuth()
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('mining')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setErr(at('Organization name is required')); return }
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.rpc('register_org', {
        p_name: name.trim(), p_industry: industry, p_full_name: fullName.trim() || null,
      })
      if (error) throw error
      // Reload memberships so the app routes into the new org (Gate re-renders
      // once the membership appears and switches out of the CreateOrg screen).
      if (reloadMemberships) await reloadMemberships()
      else window.location.reload()
    } catch (e2) {
      setErr(e2.message || 'Could not create organization')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <WFSMark size={48} />
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-ice">
            {at('Create your organization')}
          </h1>
          <p className="mt-2 text-sm text-ice-faint">
            {at('Set up your workspace to start your 30-day free trial — no card required.')}
          </p>
        </div>

        <form onSubmit={submit} className="panel space-y-4 p-6">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">
              {at('Organization name')}
            </label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={at('e.g. Pamicor Ltd')} autoFocus required />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">
              {at('Industry')}
            </label>
            <select className="input" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              {INDUSTRIES.map(([v, l]) => <option key={v} value={v} className="bg-navy-700">{at(l)}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">
              {at('Your full name')}
            </label>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)}
              placeholder={at('Optional')} />
          </div>

          {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? at('Creating…') : <><Building2 size={16} /> {at('Create workspace')} <ArrowRight size={16} /></>}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-ice-faint">
          {at('Signed in as')} <span className="text-ice">{user?.email}</span> ·{' '}
          <button onClick={signOut} className="text-accent hover:underline">{at('Sign out')}</button>
        </p>
      </div>
    </div>
  )
}
