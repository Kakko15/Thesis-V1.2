import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'
import { isE2ETestMode } from '../testing/e2eSession'
import { Button } from '../components/ui/Button'
import { GlassCard } from '../components/ui/GlassCard'
import { PageTransition } from '../components/ui/Motion'
import { Skeleton } from '../components/ui/Skeleton'
import { cn } from '../lib/utils'

const AdminOverview = lazy(() => import('./admin/AdminOverview'))
const UploadHistoryTab = lazy(() => import('./admin/UploadHistoryTab'))
const SystemManagementTab = lazy(() => import('./admin/SystemManagementTab'))
const OperationsTab = lazy(() => import('./admin/OperationsTab'))

const BASE_TABS = [
  { id: 'overview', label: 'Overview', component: AdminOverview },
  { id: 'upload_history', label: 'Upload history', component: UploadHistoryTab },
  { id: 'system', label: 'System Management', component: SystemManagementTab },
]

function AdminTabFallback() {
  return (
    <div className="space-y-4" aria-label="Loading administration data">
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  )
}

function adminSecurityState(isAdmin, query) {
  if (!isAdmin || isE2ETestMode) return 'ready'
  if (query.isLoading) return 'loading'
  if (query.isError) return 'error'
  const verified = query.data?.factors?.totp?.some((factor) => factor.status === 'verified')
  if (!verified) return 'setup'
  return query.data?.assurance?.currentLevel === 'aal2' ? 'ready' : 'challenge'
}

function AdminSecurityGate({ state, query, navigate, refreshMfa }) {
  if (state === 'loading') return <AdminTabFallback />
  const content = {
    error: {
      tone: 'text-flame-500', title: 'Security status unavailable',
      message: "The system could not verify this session's two-factor status. No administrator data was loaded.",
      label: 'Retry security check', action: () => query.refetch(),
    },
    setup: {
      tone: 'text-gold-500', title: 'Secure administrator access',
      message: 'Administrator and Operations data require verified two-factor authentication. Enable 2FA from your dashboard, then sign in again to obtain a protected session.',
      label: 'Go to account security', action: () => navigate('/dashboard'),
    },
    challenge: {
      tone: 'text-gold-500', title: 'Verify your administrator session',
      message: 'Your account has 2FA enabled, but this session has not completed the authenticator challenge.',
      label: 'Continue to 2FA verification',
      action: async () => { await refreshMfa(); navigate('/login') },
    },
  }[state]
  return (
    <PageTransition className="mx-auto max-w-3xl">
      <GlassCard className="p-8 text-center">
        <ShieldCheck className={`mx-auto ${content.tone}`} size={32} />
        <h1 className="font-display mt-4 text-2xl font-extrabold">{content.title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed opacity-65">{content.message}</p>
        <Button className="mt-6" onClick={content.action}>{content.label}</Button>
      </GlassCard>
    </PageTransition>
  )
}

export default function Admin() {
  const {
    displayName, role, department, isAdmin, isSuperadmin, refreshMfa,
  } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const mfaFactors = useQuery({
    queryKey: ['admin-mfa-factors'],
    queryFn: async () => {
      const [factors, assurance] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ])
      if (factors.error) throw factors.error
      if (assurance.error) throw assurance.error
      return { factors: factors.data, assurance: assurance.data }
    },
    enabled: isAdmin && !isE2ETestMode,
    staleTime: 30_000,
  })
  const securityState = adminSecurityState(isAdmin, mfaFactors)
  if (securityState !== 'ready') {
    return (
      <AdminSecurityGate
        state={securityState}
        query={mfaFactors}
        navigate={navigate}
        refreshMfa={refreshMfa}
      />
    )
  }

  const tabs = isSuperadmin
    ? [...BASE_TABS, { id: 'operations', label: 'Operations', component: OperationsTab }]
    : BASE_TABS
  const ActiveTab = tabs.find((tab) => tab.id === activeTab)?.component || AdminOverview

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gold-500 dark:text-gold-300">
            {displayName} • <span className="capitalize">{role === 'superadmin' ? 'Super Admin at System' : <>{role === 'admin' ? 'Administrator' : role} at {department || 'Unassigned'}</>}</span>
          </p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Institutional <span className="text-gradient-isu">Analytics</span>
          </h1>
          <p className="mt-1 text-sm opacity-55">Research usage, archive composition, and access management.</p>
        </div>
        <div className="glass flex items-center rounded-2xl p-1" role="tablist" aria-label="Administration sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300',
                activeTab === tab.id
                  ? 'bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-md'
                  : 'opacity-60 hover:opacity-100',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <Suspense fallback={<AdminTabFallback />}>
        <ActiveTab />
      </Suspense>
    </PageTransition>
  )
}
