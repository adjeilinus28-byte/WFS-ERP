import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight } from 'lucide-react'

// Subtle topographic contour backdrop — nods to TSF/terrain monitoring without
// the heavy procedural render. The signature stays the amber WFS mark.
function Backdrop() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F59E0B" stopOpacity="0.0" />
          <stop offset="1" stopColor="#F59E0B" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {Array.from({ length: 14 }).map((_, i) => (
        <path key={i} fill="none" stroke="url(#g)" strokeWidth="1"
          d={`M0 ${80 + i * 34} Q 200 ${40 + i * 34} 400 ${90 + i * 34} T 800 ${70 + i * 34}`} />
      ))}
    </svg>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const signIn = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd })
    if (error) { setErr(error.message); setBusy(false) }
    // on success, AuthProvider picks up the session and routes onward
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4">
      <Backdrop />
      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <svg viewBox="0 0 64 64" className="h-12 w-12">
            <rect width="64" height="64" rx="14" fill="#0E1424" />
            <path d="M14 20 L24 44 L32 26 L40 44 L50 20" fill="none" stroke="#F59E0B" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-ice">WFS Enterprise</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ice-faint">Streamline Every Layer</p>
        </div>

        <form onSubmit={signIn} className="panel space-y-4 p-6">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">Work email</label>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wider text-ice-faint">Password</label>
            <input className="input" type="password" autoComplete="current-password" required value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" />
          </div>
          {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-ice-faint">
          Access is provisioned by WorkFlow Solutions. Contact{' '}
          <a className="text-accent hover:underline" href="mailto:admin@workflow-app.net">admin@workflow-app.net</a>.
        </p>
      </div>
    </div>
  )
}
