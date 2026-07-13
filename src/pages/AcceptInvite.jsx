import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { at } from '../lib/tr'
import { WFSMark } from '../components/Brand'
import { Building2, Check, AlertCircle, ArrowRight } from 'lucide-react'

// Where an invited person lands (/invite/:token). Shows the org they're invited
// to. If not signed in, routes them to Login (they sign in/up with the invited
// email), then returns here to claim. accept_invite verifies the email matches.
export default function AcceptInvite({ token: tokenProp }) {
  const params = useParams()
  const token = tokenProp || params.token
  const { user, reloadMemberships } = useAuth()
  const navigate = useNavigate()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.rpc('invite_details', { p_token: token })
        setInfo(data?.[0] || null)
      } catch { setInfo(null) } finally { setLoading(false) }
    })()
  }, [token])

  const accept = async () => {
    setBusy(true); setError('')
    try {
      const { data, error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) throw error
      // Clear the stored invite now that it's accepted, so it doesn't re-trigger.
      try { sessionStorage.removeItem('wfs_pending_invite') } catch {}
      await reloadMemberships()
      // Land in the new org.
      navigate('/')
    } catch (e) {
      setError(e.message || 'Could not accept the invitation')
      setBusy(false)
    }
  }

  // Not signed in is normally handled by the Gate (which shows Login while the
  // /invite URL persists). This fallback just reloads to re-trigger that path.
  const goSignIn = () => window.location.reload()

  if (loading) return <div className="grid min-h-screen place-items-center text-ice-faint">{at('Loading…')}</div>

  const invalid = !info || info.status !== 'pending' || info.expired

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md text-center">
        <WFSMark size={48} />
        {invalid ? (
          <>
            <div className="mx-auto mt-5 grid h-12 w-12 place-items-center rounded-full bg-bad/15">
              <AlertCircle size={24} className="text-bad" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-ice">{at('Invitation unavailable')}</h1>
            <p className="mt-2 text-sm text-ice-faint">
              {!info ? at('This invitation link is invalid.')
                : info.expired ? at('This invitation has expired.')
                : at('This invitation has already been used.')}
            </p>
            <button onClick={() => { try { sessionStorage.removeItem('wfs_pending_invite') } catch {} ; navigate('/') }} className="btn-ghost mt-5">{at('Go to sign in')}</button>
          </>
        ) : (
          <>
            <div className="mx-auto mt-5 grid h-12 w-12 place-items-center rounded-full bg-accent/15">
              <Building2 size={24} className="text-accent" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-ice">
              {at('Join')} {info.org_name}
            </h1>
            <p className="mt-2 text-sm text-ice-faint">
              {at('You have been invited to join as')} <span className="text-ice">{at(info.role)}</span>.
            </p>

            {error && <p className="mx-auto mt-4 max-w-sm rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

            {user ? (
              user.email?.toLowerCase() === info.email?.toLowerCase() ? (
                <button onClick={accept} disabled={busy} className="btn-primary mx-auto mt-5">
                  <Check size={16} /> {busy ? at('Joining…') : at('Accept invitation')}
                </button>
              ) : (
                <div className="mt-5 text-sm">
                  <p className="text-warn">{at('This invitation was sent to')} {info.email}.</p>
                  <p className="mt-1 text-ice-faint">{at('You are signed in as')} {user.email}. {at('Sign in with the invited email to accept.')}</p>
                  <button onClick={() => { try { sessionStorage.removeItem('wfs_pending_invite') } catch {} ; navigate('/') }}
                    className="btn-ghost mx-auto mt-4">{at('Continue to my workspace')}</button>
                </div>
              )
            ) : (
              <button onClick={goSignIn} className="btn-primary mx-auto mt-5">
                {at('Sign in to accept')} <ArrowRight size={16} />
              </button>
            )}
            <p className="mt-4 text-xs text-ice-faint">{at('Invited email')}: {info.email}</p>
          </>
        )}
      </div>
    </div>
  )
}
