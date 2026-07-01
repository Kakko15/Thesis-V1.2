import { useState, useEffect } from 'react'
import { listPapers, deletePaper } from '../api'
import { FileText, Users, Calendar, Trash2, BookOpen, RefreshCw, AlertCircle } from 'lucide-react'

function Dashboard() {
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [toast, setToast] = useState(null)

  const fetchPapers = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listPapers()
      setPapers(data)
    } catch (err) {
      setError('Failed to connect to backend. Make sure the server is running on port 8000.')
      console.error('Failed to fetch papers:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPapers()
  }, [])

  const handleDelete = async (paperId, title) => {
    const adminSecret = window.prompt(`Are you sure you want to delete "${title}"? This will also remove all associated chunks.\n\nPlease enter the Admin Secret to confirm:`)
    if (adminSecret === null) {
      return // User cancelled
    }
    if (!adminSecret.trim()) {
      showToast('error', 'Admin Secret is required to delete a paper.')
      return
    }

    try {
      setDeleting(paperId)
      await deletePaper(paperId, adminSecret.trim())
      setPapers(prev => prev.filter(p => p.id !== paperId))
      showToast('success', `"${title}" has been deleted.`)
    } catch (err) {
      showToast('error', 'Failed to delete paper.')
      console.error('Delete error:', err)
    } finally {
      setDeleting(null)
    }
  }

  const showToast = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    })
  }

  return (
    <div className="page" id="dashboard-page">
      <div className="page-header">
        <h1>
          <BookOpen size={28} />
          Dashboard
        </h1>
        <p>Overview of your thesis archive</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon purple">
            <FileText size={22} />
          </div>
          <div className="stat-value">{papers.length}</div>
          <div className="stat-label">Total Papers</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue">
            <Users size={22} />
          </div>
          <div className="stat-value">
            {new Set(papers.map(p => p.authors).filter(Boolean)).size}
          </div>
          <div className="stat-label">Unique Authors</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <Calendar size={22} />
          </div>
          <div className="stat-value">
            {papers.length > 0
              ? `${Math.min(...papers.map(p => p.year).filter(Boolean))}–${Math.max(...papers.map(p => p.year).filter(Boolean))}`
              : '—'}
          </div>
          <div className="stat-label">Year Range</div>
        </div>
      </div>

      {/* Papers List */}
      <div className="papers-section">
        <h2>
          <FileText size={20} />
          Uploaded Papers
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchPapers}
            disabled={loading}
            style={{ marginLeft: 'auto' }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </h2>

        {loading && (
          <div className="papers-list">
            {[1, 2, 3].map(i => (
              <div key={i} className="paper-card">
                <div className="paper-info">
                  <div className="loading-skeleton" style={{ height: 20, width: '60%', marginBottom: 8 }} />
                  <div className="loading-skeleton" style={{ height: 14, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <AlertCircle size={40} style={{ color: 'var(--error)', marginBottom: 12 }} />
            <p style={{ color: 'var(--error)' }}>{error}</p>
            <button className="btn btn-secondary" onClick={fetchPapers} style={{ marginTop: 16 }}>
              Try Again
            </button>
          </div>
        )}

        {!loading && !error && papers.length === 0 && (
          <div className="empty-state">
            <FileText className="empty-state-icon" size={64} />
            <h3>No papers uploaded yet</h3>
            <p>Upload your first thesis PDF to get started with the RAG-powered archive.</p>
          </div>
        )}

        {!loading && !error && papers.length > 0 && (
          <div className="papers-list">
            {papers.map((paper, index) => (
              <div
                key={paper.id}
                className="paper-card"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="paper-info">
                  <div className="paper-title">{paper.title}</div>
                  <div className="paper-meta">
                    {paper.authors && (
                      <span><Users size={13} /> {paper.authors}</span>
                    )}
                    {paper.year && (
                      <span><Calendar size={13} /> {paper.year}</span>
                    )}
                    <span><FileText size={13} /> {formatDate(paper.created_at)}</span>
                  </div>
                </div>
                <div className="paper-actions">
                  <button
                    className="btn btn-danger btn-icon"
                    onClick={() => handleDelete(paper.id, paper.title)}
                    disabled={deleting === paper.id}
                    title="Delete paper"
                  >
                    {deleting === paper.id
                      ? <span className="loading-spinner" />
                      : <Trash2 size={16} />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}
    </div>
  )
}

export default Dashboard
