import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'
import { isE2ETestMode } from '../testing/e2eSession'
import { Button } from '../components/ui/Button'
import { GlassCard } from '../components/ui/GlassCard'
import { PageTransition } from '../components/ui/Motion'
import { Skeleton } from '../components/ui/Skeleton'
import { PageSkeleton } from '../components/ui/PageSkeleton'
import { slotKeys } from '../lib/keys'
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

const TAB_STAT_SLOTS = slotKeys(4, 'admin-tab-stat')
const TAB_PANEL_SLOTS = slotKeys(2, 'admin-tab-panel')

// Content-area skeleton shown under the real header while a tab chunk or the
// overview data loads. Mirrors AdminOverview's layout (4 stat tiles + 2 chart
// panels at their real 21rem height) so it blends seamlessly with both the
// full-page skeleton that precedes it and the content that replaces it.
function AdminTabFallback() {
  return (
    // `role="status"` is what lets the element carry a name at all — a bare div
    // cannot — and it announces the load to assistive tech rather than leaving
    // the region silent.
    <div className="space-y-6" role="status" aria-label="Loading administration data">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {TAB_STAT_SLOTS.map((slotId) => <Skeleton key={slotId} className="h-28" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {TAB_PANEL_SLOTS.map((slotId) => <Skeleton key={slotId} className="h-[21rem]" />)}
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
  // While the 2FA session check runs, keep showing the same full-page admin
  // skeleton the route gates render, so the load is one continuous skeleton
  // state instead of flashing a second, differently-shaped one.
  if (state === 'loading') return <PageSkeleton variant="admin" />
  const content = {
    error: {
      tone: 'text-flame-500', title: 'Security status unavailable',
      message: "The system could not verify this session's two-factor status. No administrator data was loaded.",
      label: 'Retry security check', action: () => query.refetch(),
    },
    setup: {
      tone: 'text-gold-500', title: 'Secure administrator access',
      message: 'Administrator and Operations data require verified two-factor authentication. Enable 2FA in Settings → Security, then sign in again to obtain a protected session.',
      label: 'Open security settings', action: () => navigate('/settings?section=security'),
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
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">{content.message}</p>
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
          <p className="text-sm font-semibold text-gold-text dark:text-gold-300">
            {displayName} • <span className="capitalize">{role === 'superadmin' ? 'Super Admin at System' : <>{role === 'admin' ? 'Administrator' : role} at {department || 'Unassigned'}</>}</span>
          </p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Research <span className="text-gradient-isu">Administration</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">Evidence readiness, archive operations, academic catalog, and access governance.</p>
        </div>
        <div className="glass flex max-w-full items-center overflow-x-auto rounded-2xl p-1" role="tablist" aria-label="Administration sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300',
                activeTab === tab.id
                  ? 'bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-md'
                  : 'text-ink-muted hover:text-ink',
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
