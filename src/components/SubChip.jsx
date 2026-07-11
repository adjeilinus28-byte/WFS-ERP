import { useNavigate } from 'react-router-dom'
import { useSubscription } from '../hooks/useSubscription'
import { at } from '../lib/tr'
import { Clock } from 'lucide-react'

// Compact subscription status chip for the header. Trial shows days left and is
// clickable to Subscribe. Active/comped orgs show nothing (no nag).
export default function SubChip() {
  const { isTrial, daysLeft } = useSubscription()
  const navigate = useNavigate()
  if (!isTrial) return null
  const urgent = daysLeft <= 5
  return (
    <button onClick={() => navigate('/subscribe')}
      className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${urgent ? 'bg-bad/15 text-bad hover:bg-bad/25' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}
      title={at('Manage subscription')}>
      <Clock size={12} /> {daysLeft} {at('days left')}
    </button>
  )
}
