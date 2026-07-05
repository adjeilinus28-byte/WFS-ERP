import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeApplier } from './context/ThemeContext'
import { ToastProvider } from './components/ui'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import Dashboard from './pages/Dashboard'
import NewsFlashAdmin from './pages/NewsFlashAdmin'
import Assets from './pages/Assets'
import WorkOrders from './pages/WorkOrders'
import Inventory from './pages/Inventory'
import Procurement from './pages/Procurement'
import Issuance from './pages/Issuance'
import PPEPlanning from './pages/PPEPlanning'
import Catering from './pages/Catering'
import Workforce from './pages/Workforce'
import HSE from './pages/HSE'
import Reports from './pages/Reports'
import HR from './pages/HR'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'

function Splash({ label = 'Loading…' }) {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3">
        <svg viewBox="0 0 64 64" className="h-10 w-10 animate-pulse">
          <rect width="64" height="64" rx="14" fill="#0E1424" />
          <path d="M14 20 L24 44 L32 26 L40 44 L50 20" fill="none" stroke="#F59E0B" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-mono text-xs uppercase tracking-widest text-ice-faint">{label}</span>
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading, membLoaded, memberships, activeOrgId } = useAuth()

  if (loading) return <Splash label="Starting WFS Enterprise" />
  if (!session) return <Login />
  if (!membLoaded) return <Splash label="Loading workspace" />
  if (memberships.length === 0 || !activeOrgId) return <NoAccess />

  return (
    <AppShell>
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
        <Route path="/workforce" element={<Workforce />} />
        <Route path="/hse" element={<HSE />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/hr" element={<HR />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
