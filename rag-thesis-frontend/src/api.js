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

// ---------- Health ----------
export async function healthCheck() {
  const { data } = await api.get('/health')
  return data
}

// ---------- Chat (RAG) ----------
export async function chatQuery(question, sessionId = null) {
  const { data } = await api.post('/chat', { question, session_id: sessionId })
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
export async function listPapers() {
  const { data } = await api.get('/papers')
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
export async function uploadPaper({ file, title, authors, year, abstract, track }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  formData.append('authors', authors || '')
  formData.append('year', year || '')
  formData.append('abstract', abstract || '')
  formData.append('track', track || '')
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

// ---------- User management (admin) ----------
export async function listUsers() {
  const { data } = await api.get('/analytics/users')
  return data
}
export async function updateUserRole(userId, role) {
  const { data } = await api.put(`/analytics/users/${userId}/role`, { role })
  return data
}

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return (
    error?.response?.data?.detail ||
    error?.message ||
    fallback
  )
}
