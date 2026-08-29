import { useLocation } from 'react-router'
import { Skeleton } from './Skeleton'
import { slotKeys } from '../../lib/keys'

const STAT_SLOTS = slotKeys(4, 'page-stat')
const ACTION_SLOTS = slotKeys(3, 'page-action')
const ROW_SLOTS = slotKeys(4, 'page-row')
const CARD_SLOTS = slotKeys(6, 'page-card')
const SESSION_SLOTS = slotKeys(5, 'page-session')
const FILTER_SLOTS = slotKeys(4, 'page-filter')
const CHART_SLOTS = slotKeys(2, 'page-chart')

/* ------------------------------------------------------------------ */
/* Per-page skeleton shapes — each mirrors the real page layout so the */
/* loading state already looks like the page that is about to appear.  */
/* ------------------------------------------------------------------ */

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <HeaderLines withButton />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_SLOTS.map((slotId) => (
          <Skeleton key={slotId} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          {ACTION_SLOTS.map((slotId) => (
            <Skeleton key={slotId} className="h-36" />
          ))}
        </div>
        <div className="glass rounded-3xl p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-6 w-40 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
          <div className="space-y-3">
            {ROW_SLOTS.map((slotId) => (
              <Skeleton key={slotId} className="h-16" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-10.5rem)] max-w-6xl gap-4 md:h-[calc(100vh-3rem)]">
      {/* Session list */}
      <div className="glass hidden w-64 shrink-0 rounded-3xl p-4 xl:block">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-3.5 w-28 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
        <div className="space-y-2">
          {SESSION_SLOTS.map((slotId) => (
            <Skeleton key={slotId} className="h-12" />
          ))}
        </div>
      </div>

      {/* Chat column */}
      <div className="glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-forest-900/10 px-5 py-3.5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-16 rounded-md" />
              <Skeleton className="h-3 w-48 rounded-md" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-32 rounded-xl" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
        {/* Messages */}
        <div className="flex-1 space-y-6 px-6 py-6">
          <div className="flex justify-end">
            <Skeleton className="h-12 w-2/5 rounded-3xl rounded-br-lg" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <Skeleton className="h-28 w-3/5 rounded-3xl rounded-tl-lg" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-12 w-1/3 rounded-3xl rounded-br-lg" />
          </div>
        </div>
        {/* Composer */}
        <div className="border-t border-forest-900/10 p-4 dark:border-white/10">
          <Skeleton className="h-14 rounded-[1.4rem]" />
          <Skeleton className="mx-auto mt-2 h-3 w-2/3 rounded-md" />
        </div>
      </div>
    </div>
  )
}

function ArchiveSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-64 rounded-xl" />
          <Skeleton className="h-4 w-72 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-80 rounded-full" />
      </div>
      {/* Filter bar */}
      <div className="glass grid items-center gap-3 rounded-3xl p-4 sm:grid-cols-2 xl:grid-cols-12">
        {FILTER_SLOTS.map((slotId, i) => (
          <Skeleton
            key={slotId}
            className={`h-11 rounded-xl ${i === 0 ? 'sm:col-span-2 xl:col-span-4' : 'xl:col-span-2'}`}
          />
        ))}
      </div>
      <Skeleton className="h-4 w-44 rounded-lg" />
      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARD_SLOTS.map((slotId) => (
          <Skeleton key={slotId} className="h-44" />
        ))}
      </div>
    </div>
  )
}

function NoveltySkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-60 rounded-xl" />
          <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
        </div>
        <Skeleton className="h-9 w-56 rounded-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Main column: dropzone + result */}
        <div className="space-y-5 lg:col-span-2">
          <div className="glass rounded-3xl p-6">
            <Skeleton className="h-56" />
          </div>
          <Skeleton className="h-40" />
        </div>
        {/* History card */}
        <div className="glass h-fit rounded-3xl p-5">
          <Skeleton className="mb-4 h-3.5 w-28 rounded-md" />
          <div className="space-y-2">
            {ROW_SLOTS.map((slotId) => (
              <Skeleton key={slotId} className="h-16" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function UploadSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2.5">
        <Skeleton className="h-9 w-56 rounded-xl" />
        <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
      </div>
      <div className="glass rounded-3xl p-6 sm:p-10">
        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-1 w-16 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-1 w-16 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        {/* Dropzone */}
        <Skeleton className="h-56" />
        <div className="mt-6 flex justify-end">
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

function AdminSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-56 rounded-lg" />
          <Skeleton className="h-9 w-80 max-w-full rounded-xl" />
          <Skeleton className="h-4 w-96 max-w-full rounded-lg" />
        </div>
        {/* Tab strip */}
        <Skeleton className="h-11 w-96 max-w-full rounded-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_SLOTS.map((slotId) => (
          <Skeleton key={slotId} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {CHART_SLOTS.map((slotId) => (
          <Skeleton key={slotId} className="h-[21rem]" />
        ))}
      </div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-9 w-44 rounded-xl" />
        <Skeleton className="h-4 w-80 max-w-full rounded-lg" />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[16rem_1fr]">
        <div className="glass flex gap-2 rounded-3xl p-2 lg:flex-col">
          {SESSION_SLOTS.map((slotId) => (
            <Skeleton key={slotId} className="h-12 min-w-44 lg:min-w-0" />
          ))}
        </div>
        <div className="space-y-5">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  )
}

function GenericSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <HeaderLines />
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  )
}

function HeaderLines({ withButton = false }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2.5">
        <Skeleton className="h-4 w-24 rounded-lg" />
        <Skeleton className="h-9 w-72 rounded-xl" />
        <Skeleton className="h-4 w-44 rounded-lg" />
        <Skeleton className="h-4 w-80 rounded-lg" />
      </div>
      {withButton && <Skeleton className="h-10 w-28 rounded-xl" />}
    </div>
  )
}

const VARIANTS = {
  dashboard: DashboardSkeleton,
  chat: ChatSkeleton,
  archive: ArchiveSkeleton,
  novelty: NoveltySkeleton,
  upload: UploadSkeleton,
  admin: AdminSkeleton,
  settings: SettingsSkeleton,
  generic: GenericSkeleton,
}

/**
 * Full-page loading skeleton. Rendered instantly while the route chunk or
 * auth session resolves, so the user never sees a bare spinner — and each
 * page gets a skeleton shaped like its own layout.
 */
export function PageSkeleton({ variant = 'dashboard' }) {
  const Shape = VARIANTS[variant] || GenericSkeleton
  return (
    <div role="status" aria-label="Loading page">
      <span className="sr-only">Loading page</span>
      <div aria-hidden="true"><Shape /></div>
    </div>
  )
}

/** Picks the skeleton matching the current route. */
export function RouteSkeleton() {
  const { pathname } = useLocation()
  const segment = pathname.split('/').filter(Boolean)[0]
  return <PageSkeleton variant={VARIANTS[segment] ? segment : 'generic'} />
}
