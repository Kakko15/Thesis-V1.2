import axios from 'axios'
import { supabase } from './supabaseClient'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 180000, // embedding-heavy operations
})

// Attach the Supabase JWT to every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

// Automatically log out if the backend rejects the token (e.g., user deleted or token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Force clear local session and reload to trigger the login screen
      await supabase.auth.signOut()
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
export const chatQuery = async (query, session_id = null, match_count = 5, department_filter = null) => {
  const { data } = await api.post('/chat', { 
    question: query, 
    session_id, 
    match_count,
    department_filter
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
export async function getPaperUrl(paperId) {
  const { data } = await api.get(`/papers/${paperId}/url`)
  return data.url
}
export async function getTracks() {
  const { data } = await api.get('/upload/tracks')
  return data.tracks
}

// ---------- Upload (background ingestion) ----------
export async function uploadPaper({ file, title, authors, year, abstract, track, department }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  formData.append('authors', authors || '')
  formData.append('year', year || '')
  formData.append('abstract', abstract || '')
  formData.append('track', track || '')
  formData.append('department', department || 'CCSICT')
  const { data } = await api.post('/upload/paper', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data // { job_id, status, message }
}
export async function getUploadStatus(jobId) {
  const { data } = await api.get(`/upload/status/${jobId}`)
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
export async function scanDuplication(file) {
  const formData = new FormData()
  formData.append('file', file)
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
  const fallbackMsg = detail || error?.message || fallback;
  return typeof error?.response?.data === 'object' && error.response.data !== null 
    ? (error.response.data.message || JSON.stringify(error.response.data)) 
    : (error?.response?.data || fallbackMsg);
}
