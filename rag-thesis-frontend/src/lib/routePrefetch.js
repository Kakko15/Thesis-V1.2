import {
  getAnalyticsOverview, getDepartments, getRecentActivity, getPublicSettings,
  getScanHistory, getSessions, getTracks, listPapers, listUsers,
} from '../api'

// Same dynamic import expressions App.jsx passes to React.lazy — the module
// graph dedupes them, so calling one warms the exact chunk the route needs.
const chunkLoaders = {
  dashboard: () => import('../pages/Dashboard'),
  archive: () => import('../pages/Archive'),
  chat: () => import('../pages/Chat'),
  novelty: () => import('../pages/Novelty'),
  upload: () => import('../pages/Upload'),
  admin: () => import('../pages/Admin'),
  settings: () => import('../pages/Settings'),
}

// The primary queries each page fires on mount. Keys must match the pages'
// useQuery keys exactly, or the prefetch warms nothing.
const queryPrefetches = {
  dashboard: [['papers', () => listPapers()]],
  archive: [
    ['papers', () => listPapers(null)],
    ['tracks', getTracks],
    ['departments', getDepartments],
  ],
  chat: [['public-settings', getPublicSettings], ['sessions', getSessions]],
  novelty: [['scan-history', getScanHistory]],
  upload: [['departments', getDepartments]],
  admin: [
    ['analytics-overview', getAnalyticsOverview],
    ['analytics-activity', () => getRecentActivity(20)],
    ['users', listUsers],
  ],
  settings: [['sessions', getSessions]],
}

// A route is warmed at most once per app session; prefetchQuery itself skips
// refetching data that is still fresh under the global staleTime.
const warmed = new Set()

/**
 * Warm the chunk and primary queries for a route (call on nav hover/focus), so
 * the page renders instantly when the click arrives. Signed-out visitors skip
 * data prefetching — most API endpoints require a session.
 */
export function prefetchRoute(pathname, queryClient, { signedIn = true } = {}) {
  const segment = pathname.split('/').filter(Boolean)[0]
  if (!segment || warmed.has(segment)) return
  warmed.add(segment)
  chunkLoaders[segment]?.().catch(() => {})
  if (!signedIn) return
  for (const [key, queryFn] of queryPrefetches[segment] || []) {
    queryClient.prefetchQuery({ queryKey: [key], queryFn }).catch(() => {})
  }
}
