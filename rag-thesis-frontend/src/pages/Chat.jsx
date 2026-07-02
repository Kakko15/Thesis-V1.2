import { useState, useEffect, useRef } from 'react'
import { chatQuery, getSessions, createSession, renameSession, deleteSession, getSessionMessages } from '../api'
import { Search, Sparkles, Send, AlertCircle, Info, MessageSquarePlus, MessageSquare, Trash2, Edit2, Check, X, BookOpen } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import ReactMarkdown from 'react-markdown'

function ChatPage() {
  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState(null)
  
  // Renaming state
  const [editingSessionId, setEditingSessionId] = useState(null)
  const [editTitle, setEditTitle] = useState('')

  const { user } = useAuth()
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  // Load sessions on mount
  useEffect(() => {
    if (user) {
      fetchSessions()
    } else {
      setLoadingSessions(false)
    }
  }, [user])

  const fetchSessions = async () => {
    try {
      setLoadingSessions(true)
      const data = await getSessions()
      const validSessions = Array.isArray(data) ? data : []
      setSessions(validSessions)
      // Auto-select latest session if none selected
      if (validSessions.length > 0 && !currentSessionId) {
        setCurrentSessionId(validSessions[0].id)
      }
    } catch (err) {
      console.error("Failed to load sessions", err)
      setSessions([])
    } finally {
      setLoadingSessions(false)
    }
  }

  // Load messages when current session changes
  useEffect(() => {
    if (user && currentSessionId) {
      fetchMessages(currentSessionId)
    } else if (!user || !currentSessionId) {
      setMessages([])
    }
  }, [currentSessionId, user])

  const fetchMessages = async (sessionId) => {
    try {
      setLoadingMessages(true)
      const data = await getSessionMessages(sessionId)
      // Format into UI message feed
      const formatted = []
      data.forEach(msg => {
        formatted.push({ id: `q-${msg.id}`, role: 'user', content: msg.question })
        formatted.push({ id: `a-${msg.id}`, role: 'ai', content: msg.answer, sources: msg.sources })
      })
      setMessages(formatted)
    } catch (err) {
      console.error("Failed to load messages", err)
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleNewChat = async () => {
    if (!user) {
      setMessages([])
      setCurrentSessionId(null)
      return
    }
    
    // We can either create an empty session now, or wait until the first message
    setCurrentSessionId(null)
    setMessages([])
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return

    const currentQuery = query.trim()
    
    // Optimistic UI update
    setQuery('')
    setMessages(prev => [...prev, { id: 'temp-q', role: 'user', content: currentQuery }])
    
    try {
      setLoading(true)
      setError(null)

      let targetSessionId = currentSessionId
      // If we are logged in and don't have a session, the backend chat api will auto-create one,
      // but we need to know what it is. Wait, our backend doesn't return the session_id!
      // To be safe, we'll create the session from the frontend first if it's missing.
      if (user && !targetSessionId) {
        const newSess = await createSession(currentQuery.substring(0, 40) + '...')
        targetSessionId = newSess.id
        setCurrentSessionId(targetSessionId)
        // Refresh session list quietly
        getSessions().then(setSessions)
      }

      const data = await chatQuery(currentQuery, targetSessionId)

      setMessages(prev => [
        ...prev.filter(m => m.id !== 'temp-q'), // remove temp
        { id: Date.now() + 'q', role: 'user', content: currentQuery },
        { id: Date.now() + 'a', role: 'ai', content: data.answer, sources: data.sources || [] }
      ])
      
    } catch (err) {
      console.error('Search error:', err)
      setError(
        err.response?.data?.detail ||
        'Failed to process your question. Make sure the backend is running and papers have been uploaded.'
      )
      // Remove temp question on error
      setMessages(prev => prev.filter(m => m.id !== 'temp-q'))
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

  const startRename = (e, session) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditTitle(session.title)
  }

  const saveRename = async (e, sessionId) => {
    e.stopPropagation()
    try {
      await renameSession(sessionId, editTitle)
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: editTitle } : s))
    } catch (err) {
      console.error("Rename failed", err)
    }
    setEditingSessionId(null)
  }

  const handleDelete = async (e, sessionId) => {
    e.stopPropagation()
    if (!window.confirm("Delete this chat?")) return
    try {
      await deleteSession(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null)
      }
    } catch (err) {
      console.error("Delete failed", err)
    }
  }

  return (
    <div className="chat-layout">
      {/* Sidebar - Chat History */}
      {user && (
        <div className="chat-sidebar">
          <button className="new-chat-btn" onClick={handleNewChat}>
            <MessageSquarePlus size={18} />
            New Chat
          </button>
          
          <div className="sessions-list">
            {loadingSessions ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-tertiary)' }}>
                <span className="loading-spinner" />
              </div>
            ) : !Array.isArray(sessions) || sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                No past conversations.
              </div>
            ) : (
              sessions.map(session => (
                <div 
                  key={session.id} 
                  className={`session-item ${currentSessionId === session.id ? 'active' : ''}`}
                  onClick={() => setCurrentSessionId(session.id)}
                >
                  <MessageSquare size={16} className="session-icon" />
                  
                  {editingSessionId === session.id ? (
                    <div className="session-edit-form" onClick={e => e.stopPropagation()}>
                      <input 
                        type="text" 
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onKeyDown={e => {
                          if(e.key === 'Enter') saveRename(e, session.id)
                          if(e.key === 'Escape') setEditingSessionId(null)
                        }}
                        autoFocus
                      />
                      <button onClick={e => saveRename(e, session.id)} className="action-icon accept"><Check size={14} /></button>
                      <button onClick={() => setEditingSessionId(null)} className="action-icon cancel"><X size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <span className="session-title">{session.title}</span>
                      <div className="session-actions">
                        <button onClick={(e) => startRename(e, session)} className="action-icon"><Edit2 size={14} /></button>
                        <button onClick={(e) => handleDelete(e, session.id)} className="action-icon delete"><Trash2 size={14} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="chat-main">
        {!user && (
          <div className="toast warning" style={{ margin: '1rem', background: 'var(--warning-transparent)', color: 'var(--warning)', border: '1px solid var(--warning)' }}>
            <Info size={18} />
            <span><strong>Guest Mode:</strong> Chat history is not saved. Log in to save conversations and enable memory.</span>
          </div>
        )}

        <div className="chat-messages">
          {messages.length === 0 && !loading && (
            <div className="chat-empty-state">
              <div className="empty-icon-wrapper">
                <Sparkles size={40} color="var(--primary)" />
              </div>
              <h2>How can I help you today?</h2>
              <p>Ask a question, and I'll search your thesis archive for the answer.</p>
            </div>
          )}

          {loadingMessages && (
             <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
               <span className="loading-spinner" /> Loading messages...
             </div>
          )}

          {messages.map((msg, index) => (
            <div key={msg.id || index} className={`chat-bubble-wrapper ${msg.role}`}>
              <div className="chat-bubble">
                <div className="bubble-content">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="bubble-sources">
                    <div className="sources-title">
                      {msg.content.includes("Thesis AI Library") || msg.content.includes("No relevant papers found") 
                        ? "Recently added thesis papers:" 
                        : "Sources:"}
                    </div>
                    {msg.sources.map((src, i) => {
                      const Content = () => (
                        <>
                          <BookOpen size={12} />
                          {src.title || 'Unknown'} {src.year ? `(${src.year})` : ''}
                        </>
                      )
                      return src.pdf_url ? (
                        <a 
                          key={i} 
                          href={src.pdf_url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="source-tag clickable"
                        >
                          <Content />
                        </a>
                      ) : (
                        <span key={i} className="source-tag">
                          <Content />
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-bubble-wrapper ai">
              <div className="chat-bubble typing">
                <Sparkles size={14} className="typing-icon" />
                <div className="typing-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="chat-bubble-wrapper ai">
              <div className="chat-bubble error">
                <AlertCircle size={16} />
                {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="chat-input-container">
          <form onSubmit={handleSearch} className="chat-input-form">
            <textarea
              className="chat-textarea"
              placeholder="Message Thesis AI Library..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={1}
            />
            <button
              type="submit"
              className="chat-send-btn"
              disabled={loading || !query.trim()}
            >
              <Send size={18} />
            </button>
          </form>
          <div className="chat-footer-text">
            Thesis AI Library can make mistakes. Consider checking important information.
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatPage
