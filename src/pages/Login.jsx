import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowRight } from 'lucide-react'
import { WFSMark } from '../components/Brand'

// Procedural "operations grid" backdrop — blueprint lines, a radar sweep, and
// connected nodes with slow pulses. Themed to an operations control centre.
// Deterministic layout (seeded) so it renders identically each load; animation
// is pure CSS and respects prefers-reduced-motion (see index.css).
function OpsBackdrop() {
  const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const { nodes, links } = useMemo(() => {
    // simple seeded PRNG for stable placement
    let s = 20260710
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const N = 26
    const nodes = Array.from({ length: N }, () => ({
      x: 40 + rnd() * 1120, y: 40 + rnd() * 720, r: 1.5 + rnd() * 2.5, d: rnd() * 6,
    }))
    // link each node to its nearest couple of neighbours
    const links = []
    nodes.forEach((a, i) => {
      const near = nodes
        .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
        .filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2)
      near.forEach((o) => { if (o.j > i && o.d < 90000) links.push([a, nodes[o.j]]) })
    })
    return { nodes, links }
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* radial glow */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(1000px 700px at 78% 12%, rgba(245,158,11,0.10), transparent 60%)' }} />
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800">
        <defs>
          <pattern id="ops-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0 H0 V40" fill="none" stroke="#F1F5F9" strokeOpacity="0.035" strokeWidth="1" />
          </pattern>
          <radialGradient id="ops-node" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#F59E0B" />
            <stop offset="1" stopColor="#F59E0B" stopOpacity="0.2" />
          </radialGradient>
        </defs>

        {/* blueprint grid */}
        <rect width="1200" height="800" fill="url(#ops-grid)" />

        {/* concentric radar rings, top-right */}
        <g transform="translate(980,150)" fill="none" stroke="#F59E0B" strokeOpacity="0.18">
          {[60, 120, 190, 270].map((r) => <circle key={r} r={r} strokeWidth="1" />)}
          <line x1="-300" y1="0" x2="300" y2="0" strokeOpacity="0.08" />
          <line x1="0" y1="-300" x2="0" y2="300" strokeOpacity="0.08" />
          {/* sweep */}
          <path d="M0 0 L270 0 A270 270 0 0 1 233 135 Z" fill="#F59E0B" fillOpacity="0.05" stroke="none">
            {!reduce && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="14s" repeatCount="indefinite" />}
          </path>
        </g>

        {/* contour lines (mining-roots nod), bottom-left */}
        <g fill="none" stroke="#F59E0B" strokeOpacity="0.10" strokeWidth="1">
          {Array.from({ length: 7 }).map((_, i) => (
            <path key={i} d={`M-50 ${560 + i * 26} Q 260 ${500 + i * 26} 520 ${580 + i * 26} T 1050 ${540 + i * 26}`} />
          ))}
        </g>

        {/* connection links */}
        <g stroke="#F59E0B" strokeOpacity="0.16" strokeWidth="1">
          {links.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />)}
        </g>

        {/* operation nodes with slow pulse */}
        <g>
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="url(#ops-node)" opacity={reduce ? 0.7 : undefined}>
              {!reduce && <animate attributeName="opacity" values="0.3;1;0.3" dur={`${4 + (i % 5)}s`} begin={`${n.d}s`} repeatCount="indefinite" />}
            </circle>
          ))}
        </g>
      </svg>
    </div>
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
    <div className="relative min-h-screen overflow-hidden bg-[#080C16] text-ice">
      <OpsBackdrop />

      {/* Split layout: brand story (lg+) | sign-in card */}
      <div className="relative grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left — brand panel */}
        <div className="hidden flex-col justify-between p-12 lg:flex">
          <div className="flex items-center gap-3">
            <WFSMark size={40} />
            <div>
              <div className="font-display text-lg font-extrabold leading-none tracking-tight">WFS Enterprise</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ice-faint">Operations Platform</div>
            </div>
          </div>

          <div className="max-w-lg">
            <h2 className="font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-tight">
              Every layer of your operation, <span className="text-accent">in one deck.</span>
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ice-dim">
              Assets, work orders, inventory, people, safety, and finance — monitored together, from the pit to the balance sheet.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-wider text-ice-faint">
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Live command deck</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Double-entry finance</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Offline-ready</span>
            </div>
          </div>

          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ice-faint/70">
            Powered by WorkFlow Solutions · Streamline Every Layer
          </div>
        </div>

        {/* Right — sign-in */}
        <div className="flex items-center justify-center px-4 py-10 lg:bg-white/[0.015] lg:backdrop-blur-sm">
          <div className="w-full max-w-sm">
            {/* Compact brand for mobile */}
            <div className="mb-7 flex flex-col items-center text-center lg:hidden">
              <WFSMark size={52} />
              <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight">WFS Enterprise</h1>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ice-faint">Operations Platform</p>
            </div>

            <div className="mb-6 hidden lg:block">
              <h1 className="font-display text-2xl font-extrabold tracking-tight">Sign in</h1>
              <p className="mt-1 text-sm text-ice-faint">Welcome back. Enter your credentials to continue.</p>
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
      </div>
    </div>
  )
}
