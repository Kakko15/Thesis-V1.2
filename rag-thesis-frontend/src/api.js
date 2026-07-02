import axios from 'axios'
import { supabase } from './supabaseClient'

const api = axios.create({
  baseURL: '',
  timeout: 120000, // 2 min timeout for embedding operations
})

// Add an interceptor to automatically attach the Supabase JWT token to every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

export async function uploadPaper(file, title, authors, year, abstract, department) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  formData.append('authors', authors || '')
  formData.append('year', year || '')
  formData.append('abstract', abstract || '')
  formData.append('department', department || '')

  const response = await api.post('/upload/paper', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data
}

export async function chatQuery(question, sessionId = null, matchCount = 5, matchThreshold = 0.3) {
  const response = await api.post('/chat', {
    question,
    session_id: sessionId,
    match_count: matchCount,
    match_threshold: matchThreshold,
  })
  return response.data
}

export async function getSessions() {
  const response = await api.get('/sessions')
  return response.data
}

export async function createSession(title) {
  const response = await api.post('/sessions', { title })
  return response.data
}

export async function renameSession(sessionId, title) {
  const response = await api.put(`/sessions/${sessionId}`, { title })
  return response.data
}

export async function deleteSession(sessionId) {
  const response = await api.delete(`/sessions/${sessionId}`)
  return response.data
}

export async function getSessionMessages(sessionId) {
  const response = await api.get(`/sessions/${sessionId}/messages`)
  return response.data
}

export async function listPapers() {
  const response = await api.get('/papers')
  return response.data
}

export async function deletePaper(paperId) {
  const response = await api.delete(`/papers/${paperId}`)
  return response.data
}

export async function healthCheck() {
  const response = await api.get('/health')
  return response.data
}

export async function scanDuplication(file) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/duplication/scan', formData)
  return response.data
}

export async function getScanHistory() {
  const response = await api.get('/duplication/history')
  return response.data
}

export async function scanDuplicationChat(scan_id, question) {
  const response = await api.post('/duplication/chat', { scan_id, question })
  return response.data
}
