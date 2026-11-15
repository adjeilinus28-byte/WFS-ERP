import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeApplier } from './context/ThemeContext'
import { ToastProvider } from './components/ui'
import AppShell from './components/AppShell'
import { WFSMark } from './components/Brand'
import Login from './pages/Login'
import CreateOrg from './pages/CreateOrg'
import Subscribe from './pages/Subscribe'
import { useSubscription } from './hooks/useSubscription'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NewsFlashAdmin = lazy(() => import('./pages/NewsFlashAdmin'))
const Assets = lazy(() => import('./pages/Assets'))
const WorkOrders = lazy(() => import('./pages/WorkOrders'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Procurement = lazy(() => import('./pages/Procurement'))
const Issuance = lazy(() => import('./pages/Issuance'))
const PPEPlanning = lazy(() => import('./pages/PPEPlanning'))
const Catering = lazy(() => import('./pages/Catering'))
const IndustrialRelations = lazy(() => import('./pages/IndustrialRelations'))
const Shifts = lazy(() => import('./pages/Shifts'))
const Training = lazy(() => import('./pages/Training'))
const Financials = lazy(() => import('./pages/Financials'))
const Workforce = lazy(() => import('./pages/Workforce'))
const HSE = lazy(() => import('./pages/HSE'))
const Reports = lazy(() => import('./pages/Reports'))
const HR = lazy(() => import('./pages/HR'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Approvals = lazy(() => import('./pages/Approvals'))
const AdminConsole = lazy(() => import('./pages/AdminConsole'))
const Team = lazy(() => import('./pages/Team'))
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'))
const Settings = lazy(() => import('./pages/Settings'))
const MyPay = lazy(() => import('./pages/MyPay'))
const AuditLog = lazy(() => import('./pages/AuditLog'))

function Splash({ label = 'Loading…' }) {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3">
        <WFSMark size={40} className="h-10 w-10 animate-pulse" />
        <span className="font-mono text-xs uppercase tracking-widest text-ice-faint">{label}</span>
      </div>
    </div>
  )
}

// Lightweight skeleton shown while a route chunk loads — mirrors a typical page:
// header, KPI cards, then a table. Pure CSS shimmer, no data.
function PageSkeleton() {
  const bar = 'rounded bg-white/[0.06] animate-pulse'
  return (
    <div className="animate-fade-in" aria-busy="true" aria-label="Loading">
      <div className={`${bar} mb-2 h-3 w-24`} />
      <div className={`${bar} mb-6 h-8 w-56`} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0,1,2,3].map((i) => (
          <div key={i} className="panel p-5">
            <div className={`${bar} mb-3 h-3 w-20`} />
            <div className={`${bar} h-7 w-16`} />
          </div>
        ))}
      </div>
      <div className="panel p-4">
        <div className={`${bar} mb-4 h-4 w-40`} />
        {[0,1,2,3,4].map((i) => (
          <div key={i} className="flex items-center gap-3 border-t border-white/[0.05] py-3">
            <div className={`${bar} h-4 flex-1`} style={{ maxWidth: `${70 - i * 8}%` }} />
            <div className={`${bar} h-4 w-16`} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading, membLoaded, memberships, activeOrgId } = useAuth()
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const urlMatch = path.match(/^\/invite\/([A-Za-z0-9]+)$/)
  // Persist the token the moment we see an invite URL, so it survives the signup
  // round-trip (during which the browser can reset the path to '/#').
  if (urlMatch && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('wfs_pending_invite', urlMatch[1])
  }
  const pendingToken = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem('wfs_pending_invite') : null
  const inviteToken = urlMatch ? urlMatch[1] : pendingToken

  if (loading) return <Splash label="Starting WFS Enterprise" />

  // Invitation claim is reachable before org gating. If not signed in, show Login
  // (the token is safely stored); once signed in, show the accept screen for the
  // pending token even if the URL was reset during signup.
  if (inviteToken) {
    if (!session) return <Login />
    return (
      <Suspense fallback={<Splash label="Loading invitation" />}>
        <AcceptInvite token={inviteToken} />
      </Suspense>
    )
  }

  if (!session) return <Login />
  if (!membLoaded) return <Splash label="Loading workspace" />
  if (memberships.length === 0 || !activeOrgId) return <CreateOrg />

  return <SubscribedApp />
}

// Gates the app behind an active subscription. Expired orgs see Subscribe;
// platform owners (super-admins) and trial/active orgs pass through.
function SubscribedApp() {
  const { gated } = useSubscription()
  if (gated) return <Subscribe />

  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/news" element={<NewsFlashAdmin />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/procurement" element={<Procurement />} />
        <Route path="/issuance" element={<Issuance />} />
        <Route path="/ppe" element={<PPEPlanning />} />
        <Route path="/catering" element={<Catering />} />
        <Route path="/relations" element={<IndustrialRelations />} />
        <Route path="/shifts" element={<Shifts />} />
        <Route path="/training" element={<Training />} />
        <Route path="/financials" element={<Financials />} />
        <Route path="/workforce" element={<Workforce />} />
        <Route path="/hse" element={<HSE />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/hr" element={<HR />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/subscribe" element={<Subscribe />} />
        <Route path="/admin" element={<AdminConsole />} />
        <Route path="/team" element={<Team />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/my-pay" element={<MyPay />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </AppShell>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeApplier />
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  )
}
