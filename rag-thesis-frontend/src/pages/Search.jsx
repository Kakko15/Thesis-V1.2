import { useState } from 'react'
import { chatQuery } from '../api'
import { Search, Sparkles, BookOpen, Send, AlertCircle } from 'lucide-react'

function SearchPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return

    const currentQuery = query.trim()

    try {
      setLoading(true)
      setError(null)
      setResult(null)

      const data = await chatQuery(currentQuery)

      const entry = {
        question: currentQuery,
        answer: data.answer,
        sources: data.sources || [],
        timestamp: new Date().toLocaleTimeString(),
      }

      setResult(entry)
      setHistory(prev => [entry, ...prev])
      setQuery('')
    } catch (err) {
      console.error('Search error:', err)
      setError(
        err.response?.data?.detail ||
        'Failed to process your question. Make sure the backend is running and papers have been uploaded.'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSearch(e)
    }
  }

  return (
    <div className="page" id="search-page">
      <div className="page-header">
        <h1>
          <Search size={28} />
          Search Archive
        </h1>
        <p>Ask questions about your thesis papers using AI-powered search</p>
      </div>

      <div className="search-container">
        {/* Search Box */}
        <form onSubmit={handleSearch} className="search-box">
          <div className="search-input-wrapper">
            <div style={{ position: 'relative', flex: 1 }}>
              <Search className="search-icon" size={20} />
              <input
                type="text"
                className="search-input"
                placeholder="Ask a question about your thesis papers..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                id="search-query-input"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loading || !query.trim()}
            >
              {loading ? (
                <span className="loading-spinner" />
              ) : (
                <Send size={20} />
              )}
            </button>
          </div>
        </form>

        {/* Loading */}
        {loading && (
          <div className="answer-card">
            <div className="answer-header">
              <div className="ai-badge">
                <Sparkles size={14} />
                AI is thinking...
              </div>
            </div>
            <div className="typing-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="answer-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--error)' }}>
              <AlertCircle size={20} />
              <p style={{ color: 'var(--error)' }}>{error}</p>
            </div>
          </div>
        )}

        {/* Current Result */}
        {result && !loading && (
          <div className="answer-card">
            <div className="answer-header">
              <div className="ai-badge">
                <Sparkles size={14} />
                AI Response
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                {result.timestamp}
              </span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--accent-light)', fontWeight: 600, marginBottom: 8 }}>
                Q: {result.question}
              </p>
            </div>

            <div className="answer-text">
              {result.answer}
            </div>

            {result.sources && result.sources.length > 0 && (
              <div className="answer-sources">
                <h4>📚 Sources</h4>
                <div>
                  {result.sources.map((source, i) => (
                    <span key={i} className="source-tag">
                      <BookOpen size={12} />
                      {source.title || 'Unknown'}
                      {source.year && ` (${source.year})`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 1 && (
          <div style={{ marginTop: 32 }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-tertiary)', marginBottom: 16 }}>
              Previous Questions
            </h3>
            {history.slice(1).map((entry, i) => (
              <div key={i} className="card" style={{ marginBottom: 12, padding: 16 }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--accent-light)', fontWeight: 600, marginBottom: 6 }}>
                  Q: {entry.question}
                </p>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {entry.answer.length > 300 ? entry.answer.substring(0, 300) + '...' : entry.answer}
                </p>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 8, display: 'block' }}>
                  {entry.timestamp}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && !error && history.length === 0 && (
          <div className="empty-state">
            <Sparkles className="empty-state-icon" size={64} />
            <h3>Ask anything about your papers</h3>
            <p>
              The AI will search through your uploaded thesis papers and generate
              an answer based on the most relevant content.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPage
