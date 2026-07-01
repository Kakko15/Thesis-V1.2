import axios from 'axios'

const api = axios.create({
  baseURL: '',
  timeout: 120000, // 2 min timeout for embedding operations
})

const ADMIN_SECRET = 'admin123' // Default admin secret

export async function uploadPaper(file, title, authors, year, abstract, adminSecret) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  formData.append('authors', authors || '')
  formData.append('year', year || '')
  formData.append('abstract', abstract || '')

  const response = await api.post('/upload/paper', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'x-admin-secret': adminSecret,
    },
  })
  return response.data
}

export async function chatQuery(question, matchCount = 5, matchThreshold = 0.3) {
  const response = await api.post('/chat', {
    question,
    match_count: matchCount,
    match_threshold: matchThreshold,
  })
  return response.data
}

export async function listPapers() {
  const response = await api.get('/papers')
  return response.data
}

export async function deletePaper(paperId, adminSecret) {
  const response = await api.delete(`/papers/${paperId}`, {
    headers: {
      'x-admin-secret': adminSecret,
    },
  })
  return response.data
}

export async function healthCheck() {
  const response = await api.get('/health')
  return response.data
}
