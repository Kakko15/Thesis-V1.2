import axios from 'axios'
import { supabase } from './supabaseClient'
import { isE2ETestMode, readE2EAuthFixture } from './testing/e2eSession'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 180000, // embedding-heavy operations
})

// A 503 is an explicit backend readiness/configuration failure. Retrying it in
// the Axios interceptor and then again in React Query multiplies one failure
// into many identical browser-console errors without improving recovery.
// Keep automatic GET retries only for genuinely transient gateway failures.
const TRANSIENT_GATEWAY_STATUSES = new Set([502, 504])
const MAX_TRANSIENT_GET_RETRIES = 2
const DEV_BACKEND_READY_ATTEMPTS = 40
const SHOULD_WAIT_FOR_DEV_BACKEND = import.meta.env.DEV && !import.meta.env.VITE_API_URL

let backendReady = !SHOULD_WAIT_FOR_DEV_BACKEND
let backendReadyPromise = null

function guestRateId() {
  const storageKey = 'iskai_guest_rate_id'
  let value = window.sessionStorage.getItem(storageKey)
  if (!value) {
    if (typeof window.crypto?.randomUUID === 'function') {
      value = window.crypto.randomUUID()
    } else if (typeof window.crypto?.getRandomValues === 'function') {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16))
      value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    } else {
      throw new TypeError('Secure random generation is unavailable in this browser.')
    }
    window.sessionStorage.setItem(storageKey, value)
  }
  return value
}

function retryDelay(attempt) {
  return new Promise((resolve) => window.setTimeout(resolve, attempt * 350))
}

async function waitForBackend() {
  if (backendReady) return
  if (!backendReadyPromise) {
    backendReadyPromise = (async () => {
      for (let attempt = 1; attempt <= DEV_BACKEND_READY_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch('/__backend-ready', { cache: 'no-store' })
          const status = await response.json()
          if (status.ready) {
            backendReady = true
            return
          }
        } catch {
          // Vite may itself be finishing a config reload; retry quietly.
        }
        await retryDelay(1)
      }
      throw new Error('The backend did not become ready within 14 seconds.')
    })().finally(() => {
      backendReadyPromise = null
    })
  }
  return backendReadyPromise
}

// Attach the Supabase JWT to every request
api.interceptors.request.use(async (config) => {
  if (SHOULD_WAIT_FOR_DEV_BACKEND) await waitForBackend()
  if (isE2ETestMode) {
    const fixture = readE2EAuthFixture()
    if (fixture?.user) {
      config.headers.Authorization = 'Bearer deterministic-e2e-token'
    } else {
      config.headers['X-Guest-ID'] = guestRateId()
    }
    return config
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  } else {
    config.headers['X-Guest-ID'] = guestRateId()
  }
  return config
})

// Automatically log out if the backend rejects the token (e.g., user deleted or token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config
    const status = error.response?.status
    const isRetryableGet = config?.method?.toLowerCase() === 'get'
      && TRANSIENT_GATEWAY_STATUSES.has(status)
      && (config.__transientGetRetries || 0) < MAX_TRANSIENT_GET_RETRIES

    if (isRetryableGet) {
      backendReady = false
      config.__transientGetRetries = (config.__transientGetRetries || 0) + 1
      await retryDelay(config.__transientGetRetries)
      return api.request(config)
    }

    if (error.response?.status === 401) {
      // Force clear local session and reload to trigger the login screen
      if (!isE2ETestMode) await supabase.auth.signOut()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ---------- Health ----------
export async function healthCheck() {
  const { data } = await api.get('/health')
  return data
}

// ---------- Chat (RAG) ----------
export const chatQuery = async (
  query,
  session_id = null,
  department_filter = null,
  guest_history = [],
  guest_source_ids = [],
) => {
  const { data } = await api.post('/chat', { 
    question: query, 
    session_id, 
    department_filter,
    guest_history,
    guest_source_ids,
  })
  return data
}

// ---------- Sessions ----------
export async function getSessions() {
  const { data } = await api.get('/sessions')
  return data
}
export async function createSession(title) {
  const { data } = await api.post('/sessions', { title })
  return data
}
export async function renameSession(sessionId, title) {
  const { data } = await api.put(`/sessions/${sessionId}`, { title })
  return data
}
export async function deleteSession(sessionId) {
  const { data } = await api.delete(`/sessions/${sessionId}`)
  return data
}
export async function getSessionMessages(sessionId) {
  const { data } = await api.get(`/sessions/${sessionId}/messages`)
  return data
}

// ---------- Papers (metadata only — indirect access model) ----------
export const listPapers = async (department = null) => {
  const url = department ? `/papers?department=${encodeURIComponent(department)}` : '/papers'
  const { data } = await api.get(url)
  return data
}

export async function deletePaper(paperId) {
  const { data } = await api.delete(`/papers/${paperId}`)
  return data
}
export async function getPublicSettings() {
  const { data } = await api.get('/settings/public')
  return data
}
export async function getTracks() {
  const { data } = await api.get('/upload/tracks')
  return data.tracks
}

// ---------- Upload (background ingestion) ----------
export async function uploadPaper({ file, title, authors, year, abstract, track, department, idempotencyKey }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  formData.append('authors', authors || '')
  formData.append('year', year || '')
  formData.append('abstract', abstract || '')
  formData.append('track', track || '')
  formData.append('department', department || 'CCSICT')
  const { data } = await api.post('/upload/paper', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  })
  return data // { job_id, idempotency_key, status, message }
}
export async function getUploadStatus(jobId) {
  const { data } = await api.get(`/upload/status/${jobId}`)
  return data
}
export async function cancelUploadJob(jobId, reason = '') {
  const { data } = await api.post(`/upload/jobs/${jobId}/cancel`, { reason: reason || null })
  return data
}
export async function extractMetadata(file) {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/upload/extract-metadata', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data // { title, authors }
}

// ---------- Topic novelty / duplication (faculty + admin) ----------
export async function scanDuplication(file, department = null) {
  const formData = new FormData()
  formData.append('file', file)
  if (department) formData.append('department', department)
  const { data } = await api.post('/duplication/scan', formData)
  return data
}
export async function getScanHistory() {
  const { data } = await api.get('/duplication/history')
  return data
}
export async function scanDuplicationChat(scanId, question) {
  const { data } = await api.post('/duplication/chat', { scan_id: scanId, question })
  return data
}

// ---------- Analytics ----------
export async function getPublicSummary() {
  const { data } = await api.get('/analytics/summary')
  return data
}
export async function getAnalyticsOverview() {
  const { data } = await api.get('/analytics/overview')
  return data
}
export async function getRecentActivity(limit = 25) {
  const { data } = await api.get('/analytics/activity', { params: { limit } })
  return data
}
export async function getMyProfile() {
  const { data } = await api.get('/analytics/me')
  return data
}
export async function updateMyProfile(payload) {
  const { data } = await api.put('/analytics/me', payload)
  return data
}

// ---------- User management (admin) ----------
export async function listUsers() {
  const { data } = await api.get('/analytics/users')
  return data
}
export async function updateUserRole(userId, payload) {
  const body = typeof payload === 'string' ? { role: payload } : payload;
  const { data } = await api.put(`/analytics/users/${userId}/role`, body)
  return data
}
export async function deleteUser(userId) {
  const { data } = await api.delete(`/analytics/users/${userId}`)
  return data
}
export async function updateUserDetails(userId, payload) {
  const { data } = await api.put(`/analytics/users/${userId}/details`, payload)
  return data
}
export async function getSystemLogs(limit = 200) {
  const { data } = await api.get('/analytics/logs/system', { params: { limit } })
  return data
}

// ---------- Operations (superadmin only) ----------
function requireOperationsObject(data, field = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Invalid operations response from the backend.')
  }
  if (field && !Array.isArray(data[field])) {
    throw new TypeError(`Invalid operations ${field} response from the backend.`)
  }
  return field ? data[field] : data
}

export async function getOperationsSummary() {
  const { data } = await api.get('/maintenance/operations/summary')
  return requireOperationsObject(data)
}
export async function getIngestionWorkers() {
  const { data } = await api.get('/maintenance/workers')
  return requireOperationsObject(data, 'workers')
}
export async function getOperationalJobs(limit = 100) {
  const { data } = await api.get('/maintenance/upload-jobs', { params: { limit } })
  return requireOperationsObject(data, 'jobs')
}
export async function getOperationalAlerts(limit = 100) {
  const { data } = await api.get('/maintenance/alerts', { params: { limit } })
  return requireOperationsObject(data, 'alerts')
}
export async function acknowledgeOperationalAlert(alertId) {
  const { data } = await api.post(`/maintenance/alerts/${alertId}/acknowledge`)
  return data
}
export async function getRetentionReport() {
  const { data } = await api.get('/maintenance/retention/report')
  return data
}

// Departments API
export async function getDepartments() {
  const { data } = await api.get('/departments/')
  return data
}
export async function createDepartment(payload) {
  const { data } = await api.post('/departments/', payload)
  return data
}
export async function updateDepartment(departmentId, payload) {
  const { data } = await api.put(`/departments/${departmentId}`, payload)
  return data
}
export async function deleteDepartment(departmentId) {
  const { data } = await api.delete(`/departments/${departmentId}`)
  return data
}

// Settings API
export async function getFeaturePermissions() {
  const { data } = await api.get('/settings/features')
  return data
}
export async function updateFeaturePermissions(payload) {
  const { data } = await api.put('/settings/features', payload)
  return data
}

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map(d => `${d.loc?.join('.') || 'Field'}: ${d.msg}`).join(', ');
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  const message = error?.response?.data?.message
  if (typeof message === 'string' && message.trim()) return message
  if (!error?.response && typeof error?.message === 'string' && error.message.trim()) {
    return error.message
  }
  return fallback
}
