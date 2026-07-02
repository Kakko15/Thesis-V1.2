import { useState, useEffect, useRef } from 'react'
import { getScanHistory, scanDuplication, scanDuplicationChat } from '../api'
import { FileSearch, UploadCloud, AlertCircle, FileText, CheckCircle, XCircle, FileBarChart, Clock, Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useAuth } from '../context/AuthContext'
import { format } from 'date-fns'

function DuplicationCheck() {
  const { user } = useAuth()
  const [history, setHistory] = useState([])
  const [currentScan, setCurrentScan] = useState(null)
  
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // Chat state
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (user) loadHistory()
  }, [user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentScan?.chat_log])

  const loadHistory = async () => {
    try {
      const data = await getScanHistory()
      setHistory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error("Failed to load scan history", err)
    }
  }

  const handleScan = async (e) => {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setError(null)
    setCurrentScan(null)

    try {
      const result = await scanDuplication(file)
      setCurrentScan(result)
      setFile(null)
      loadHistory()
    } catch (err) {
      console.error('Scan failed:', err)
      setError(err.response?.data?.detail || 'Failed to scan document.')
    } finally {
      setLoading(false)
    }
  }

  const handleChatSubmit = async (e) => {
    e.preventDefault()
    if (!chatInput.trim() || !currentScan) return
    
    const question = chatInput.trim()
    setChatInput('')
    setChatLoading(true)
    
    // Optimistic UI update
    const optimisticLog = [...(currentScan.chat_log || []), { role: 'user', content: question }]
    setCurrentScan({ ...currentScan, chat_log: optimisticLog })

    try {
      const res = await scanDuplicationChat(currentScan.id, question)
      setCurrentScan({ ...currentScan, chat_log: res.chat_log })
      
      // Update history list so sidebar has latest data if clicked again
      setHistory(prev => prev.map(h => h.id === currentScan.id ? { ...h, chat_log: res.chat_log } : h))
    } catch (err) {
      console.error("Chat failed:", err)
      setError("Failed to send message.")
      // Revert optimistic
      setCurrentScan({ ...currentScan, chat_log: optimisticLog.slice(0, -1) })
    } finally {
      setChatLoading(false)
    }
  }

  const selectHistoryItem = (item) => {
    setCurrentScan(item)
    setFile(null)
    setError(null)
  }

  return (
    <div className="duplication-layout">
      {/* Sidebar - History */}
      <div className="duplication-sidebar">
        <button 
          className="new-scan-btn" 
          onClick={() => { setCurrentScan(null); setFile(null); setError(null); }}
        >
          <FileSearch size={18} />
          New Scan
        </button>
        
        <div className="history-list">
          <h3 className="history-title">Scan History</h3>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
              No past scans.
            </div>
          ) : (
            history.map(item => (
              <div 
                key={item.id} 
                className={`history-item ${currentScan?.id === item.id ? 'active' : ''}`}
                onClick={() => selectHistoryItem(item)}
              >
                <Clock size={14} className="history-icon" />
                <div className="history-info">
                  <span className="history-filename">{item.filename}</span>
                  <span className="history-date">
                    {format(new Date(item.created_at), 'MMM d, yyyy h:mm a')} • {item.duplication_percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Area */}
      <div className="duplication-main">
        {!currentScan ? (
          <div className="scan-upload-container">
            <h2>Scan a New Document</h2>
            <p>Upload a draft thesis to check for duplication against the library.</p>
            
            {error && (
              <div className="toast error" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={18} /> {error}
              </div>
            )}

            <form onSubmit={handleScan} className="scan-form">
              <div className="file-dropzone">
                <UploadCloud size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
                <h3>Upload PDF</h3>
                <input 
                  type="file" 
                  accept="application/pdf"
                  onChange={e => setFile(e.target.files[0])}
                  disabled={loading}
                />
                {file && <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Selected: {file.name}</p>}
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', marginTop: '1.5rem' }}
                disabled={loading || !file}
              >
                {loading ? 'Scanning Document...' : 'Run Duplication Check'}
              </button>
            </form>
          </div>
        ) : (
          <div className="scan-results-container">
            <div className="results-header">
              <h2>Scan Report: {currentScan.filename}</h2>
              <span className="scan-date">Scanned on {format(new Date(currentScan.created_at), 'MMMM d, yyyy h:mm a')}</span>
            </div>

            <div className="results-grid">
              {/* Overall Percentage Card */}
              <div className="result-card percentage-card">
                <h3>Overall Duplication</h3>
                <div className={`percentage-circle ${currentScan.duplication_percentage > 20 ? 'danger' : 'safe'}`}>
                  <span>{currentScan.duplication_percentage.toFixed(1)}%</span>
                </div>
                <p>{currentScan.duplication_percentage > 20 ? 'High Risk of Plagiarism' : 'Within Acceptable Limits'}</p>
              </div>

              {/* AI Verdict Card */}
              <div className="result-card verdict-card">
                <h3>AI Analysis & Verdict</h3>
                <div className="verdict-content">
                  <ReactMarkdown>{currentScan.verdict_summary}</ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Top Matches */}
            <div className="matches-section">
              <h3>Top 3 Nearest Matches</h3>
              {currentScan.top_matches && currentScan.top_matches.length > 0 ? (
                <div className="matches-list">
                  {currentScan.top_matches.map((match, idx) => (
                    <div key={idx} className="match-card">
                      <div className="match-rank">#{idx + 1}</div>
                      <div className="match-details">
                        <h4>{match.title}</h4>
                        <p className="match-meta">Authors: {match.authors || 'Unknown'} | Year: {match.year || 'Unknown'}</p>
                        <div className="match-stats">
                          <span className="stat-pill"><FileBarChart size={14}/> {match.similarity}% Peak Similarity</span>
                          <span className="stat-pill"><FileText size={14}/> {match.match_count} Paragraphs Matched</span>
                        </div>
                      </div>
                      {match.pdf_url && (
                        <a href={match.pdf_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                          View PDF
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-matches">
                  <CheckCircle size={32} color="var(--success)" style={{ marginBottom: '0.5rem' }} />
                  <p>No similar papers found in the database.</p>
                </div>
              )}
            </div>
            
            {/* Interactive Chat Section */}
            <div className="duplication-chat-section" style={{ marginTop: '3rem', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
              <h3 style={{ marginBottom: '1.5rem' }}>Discuss this Report</h3>
              <div className="chat-feed" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                {(!currentScan.chat_log || currentScan.chat_log.length === 0) ? (
                  <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', margin: '2rem 0' }}>
                    Ask a question about the duplicated text or request a rewrite.
                  </p>
                ) : (
                  currentScan.chat_log.map((msg, idx) => (
                    <div key={idx} className={`chat-bubble-wrapper ${msg.role}`}>
                      <div className="chat-bubble">
                        <div className="bubble-content">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="chat-bubble-wrapper ai">
                    <div className="chat-bubble"><div className="typing-indicator"><span/><span/><span/></div></div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              
              <form onSubmit={handleChatSubmit} className="chat-input-container" style={{ marginTop: '1.5rem' }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="E.g., Which specific methodology concept was copied?"
                  disabled={chatLoading}
                />
                <button type="submit" disabled={chatLoading || !chatInput.trim()}>
                  <Send size={18} />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DuplicationCheck
