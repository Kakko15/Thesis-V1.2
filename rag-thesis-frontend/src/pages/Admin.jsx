import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { PageTransition } from '../components/ui/Motion'
import { Skeleton } from '../components/ui/Skeleton'
import { cn } from '../lib/utils'

const AdminOverview = lazy(() => import('./admin/AdminOverview'))
const UploadHistoryTab = lazy(() => import('./admin/UploadHistoryTab'))
const SystemManagementTab = lazy(() => import('./admin/SystemManagementTab'))

const TABS = [
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

export default function Admin() {
  const { displayName, role, department } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const ActiveTab = TABS.find((tab) => tab.id === activeTab)?.component || AdminOverview

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
          {TABS.map((tab) => (
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
