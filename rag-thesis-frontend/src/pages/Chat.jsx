import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import {
  Send, Plus, MessageSquareText, Trash2, PencilLine, Sparkles,
  AlertTriangle, BookMarked, History, X, Info, GraduationCap,
} from 'lucide-react'
import {
  chatQuery, getSessions, getSessionMessages, renameSession, deleteSession, apiErrorMessage, getPaperUrl, getDepartments
} from '../api'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import { GlassCard } from '../components/ui/GlassCard'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { PageTransition } from '../components/ui/Motion'
import { Logo } from '../components/ui/Logo'
import { cn, timeAgo } from '../lib/utils'

const STARTERS = [
  'What machine learning techniques were used in past CCSICT theses?',
  'Are there existing studies about attendance monitoring systems?',
  'Summarize local research on network security for campus networks.',
  'Has anyone built a recommendation system in the Data Mining track?',
]

/* ------------------------------------------------------------------ */
/* Citation source card                                                */
/* ------------------------------------------------------------------ */
function SourceCard({ source, index }) {
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const url = await getPaperUrl(source.id)
      window.open(url, '_blank')
    } catch (err) {
      toast.error('Could not load PDF', { description: apiErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.08, duration: 0.4 }}
      onClick={handleClick}
      className={cn(
        "glass flex items-start gap-3 rounded-2xl p-3.5 transition duration-200",
        isAdmin ? "cursor-pointer hover:bg-forest-900/5 dark:hover:bg-white/5 active:scale-[0.98]" : "",
        loading ? "opacity-60 pointer-events-none animate-pulse" : ""
      )}
      title={isAdmin ? "Click to view original PDF" : ""}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gold-400/20 font-mono text-xs font-bold text-gold-600 dark:text-gold-300">
        {index + 1}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-snug">{source.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-60">
          {source.authors && <span>{source.authors}</span>}
          {source.year && <span>· {source.year}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {source.track && <Badge tone="forest">{source.track}</Badge>}
          {typeof source.similarity === 'number' && (
            <Badge tone="neutral">{source.similarity}% match</Badge>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* 85% duplication alert banner                                        */
/* ------------------------------------------------------------------ */
function DuplicationBanner({ alert }) {
  if (!alert?.flagged) return null
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
      className="mt-3 overflow-hidden rounded-2xl border border-flame-500/30 bg-flame-500/8 dark:bg-flame-500/10"
    >
      <div className="flex items-center gap-3 border-b border-flame-500/20 px-4 py-3">
        <AlertTriangle size={18} className="shrink-0 text-flame-500" />
        <div className="text-sm font-bold text-flame-600 dark:text-flame-400">
          Potential topic duplication — {alert.similarity}% similarity
        </div>
      </div>
      <div className="space-y-2.5 px-4 py-3.5 text-sm">
        <p className="opacity-80">
          This topic meets the {alert.threshold}% cosine-similarity duplication threshold against an
          archived CCSICT study:
        </p>
        <div className="glass rounded-xl p-3">
          <div className="font-semibold">{alert.matched_paper?.title}</div>
          <div className="mt-0.5 text-xs opacity-60">
            {alert.matched_paper?.authors}
            {alert.matched_paper?.year ? ` · ${alert.matched_paper.year}` : ''}
            {alert.matched_paper?.track ? ` · ${alert.matched_paper.track}` : ''}
          </div>
        </div>
        {alert.summary && (
          <p className="text-xs leading-relaxed opacity-70">
            <span className="font-semibold">About the matched study: </span>
            {alert.summary}
          </p>
        )}
        <p className="text-xs italic opacity-55">
          Consider building upon this work rather than duplicating it — discuss with your faculty adviser.
        </p>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Message bubbles                                                     */
/* ------------------------------------------------------------------ */
function UserBubble({ text }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      className="flex justify-end"
    >
      <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-gradient-to-br from-forest-600 to-forest-800 px-5 py-3 text-sm leading-relaxed text-white shadow-lg shadow-forest-900/20 sm:max-w-[70%]">
        {text}
      </div>
    </motion.div>
  )
}

function AiBubble({ message, animate }) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 14, filter: 'blur(4px)' } : false}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
      className="flex gap-3"
    >
      <div className="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-md sm:flex">
        <Sparkles size={15} className="text-gold-300" />
      </div>
      <div className="min-w-0 max-w-full flex-1 sm:max-w-[85%]">
        <div className="glass rounded-3xl rounded-tl-lg px-5 py-4">
          <div className="prose-chat">
            <ReactMarkdown>{message.answer}</ReactMarkdown>
          </div>
          {message.no_relevant_thesis && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 text-xs font-medium text-gold-600 dark:text-gold-300">
              <Info size={13} className="shrink-0" />
              No archived thesis passed the relevance threshold for this query.
            </div>
          )}
        </div>
        {message.sources?.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider opacity-50">
              <BookMarked size={12} /> Cited sources
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {message.sources.map((s, i) => (
                <SourceCard key={`${s.id}-${i}`} source={s} index={i} />
              ))}
            </div>
          </div>
        )}
        <DuplicationBanner alert={message.duplication_alert} />
      </div>
    </motion.div>
  )
}

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex gap-3"
    >
      <div className="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 sm:flex">
        <Sparkles size={15} className="animate-pulse text-gold-300" />
      </div>
      <div className="glass flex items-center gap-1.5 rounded-3xl rounded-tl-lg px-5 py-4">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
            className="h-2 w-2 rounded-full bg-forest-500 dark:bg-gold-300"
          />
        ))}
        <span className="ml-2 text-xs opacity-50">Searching the archive…</span>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Session sidebar                                                     */
/* ------------------------------------------------------------------ */
function SessionList({ sessions, activeId, onSelect, onRename, onDelete, onNew }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider opacity-50">
          <History size={13} /> Conversations
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New conversation">
          <Plus size={16} />
        </Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {sessions.map((s) => (
            <motion.div
              key={s.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2.5 transition-colors duration-200',
                activeId === s.id
                  ? 'bg-forest-600/12 dark:bg-forest-400/12'
                  : 'hover:bg-forest-900/6 dark:hover:bg-white/6',
              )}
              onClick={() => onSelect(s)}
            >
              <MessageSquareText size={14} className="shrink-0 opacity-50" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.title}</div>
                <div className="text-[0.65rem] opacity-45">{timeAgo(s.created_at)}</div>
              </div>
              <div className="hidden shrink-0 gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => { e.stopPropagation(); onRename(s) }}
                  aria-label="Rename"
                  className="rounded-lg p-1.5 opacity-50 hover:bg-forest-900/10 hover:opacity-100 dark:hover:bg-white/10"
                >
                  <PencilLine size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(s) }}
                  aria-label="Delete"
                  className="rounded-lg p-1.5 text-flame-500 opacity-50 hover:bg-flame-500/10 hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-xs opacity-45">
            No conversations yet. Ask your first question!
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main chat page                                                      */
/* ------------------------------------------------------------------ */
export default function Chat() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [messages, setMessages] = useState([]) // {kind:'user'|'ai', ...}
  const [input, setInput] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('all')
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
    enabled: !!user,
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const loadSession = async (session) => {
    setSessionId(session.id)
    setSidebarOpen(false)
    try {
      const msgs = await getSessionMessages(session.id)
      const rebuilt = []
      msgs.forEach((m) => {
        rebuilt.push({ kind: 'user', text: m.question })
        rebuilt.push({
          kind: 'ai',
          answer: m.answer,
          sources: m.sources || [],
          duplication_alert: m.duplication_alert,
        })
      })
      setMessages(rebuilt)
    } catch (err) {
      toast.error('Could not load conversation', { description: apiErrorMessage(err) })
    }
  }

  const newConversation = () => {
    setSessionId(null)
    setMessages([])
    setSidebarOpen(false)
    inputRef.current?.focus()
  }

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || sending) return
    setInput('')
    setMessages((m) => [...m, { kind: 'user', text: question }])
    setSending(true)
    try {
      const res = await chatQuery(question, sessionId, 5, filterDepartment !== 'all' ? filterDepartment : null)
      setMessages((m) => [...m, { kind: 'ai', ...res, isNew: true }])
      if (res.session_id && res.session_id !== sessionId) {
        setSessionId(res.session_id)
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }
    } catch (err) {
      toast.error('The archive could not answer', { description: apiErrorMessage(err) })
      setMessages((m) => m.slice(0, -1))
      setInput(question)
    } finally {
      setSending(false)
    }
  }

  const submitRename = async () => {
    if (!renameValue.trim()) return
    setBusy(true)
    try {
      await renameSession(renameTarget.id, renameValue.trim())
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('Conversation renamed')
      setRenameTarget(null)
    } catch (err) {
      toast.error('Rename failed', { description: apiErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const submitDelete = async () => {
    setBusy(true)
    try {
      await deleteSession(deleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (deleteTarget.id === sessionId) newConversation()
      toast.success('Conversation deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error('Delete failed', { description: apiErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageTransition className="mx-auto flex h-[calc(100vh-6.5rem)] max-w-6xl gap-4 lg:h-[calc(100vh-3rem)]">
      {/* Session sidebar (desktop) */}
      {user && (
        <GlassCard className="hidden w-64 shrink-0 p-4 xl:block">
          <SessionList
            sessions={sessions}
            activeId={sessionId}
            onSelect={loadSession}
            onRename={(s) => { setRenameTarget(s); setRenameValue(s.title) }}
            onDelete={setDeleteTarget}
            onNew={newConversation}
          />
        </GlassCard>
      )}

      {/* Mobile session drawer */}
      <AnimatePresence>
        {user && sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-[60] bg-canvas-950/60 backdrop-blur-sm xl:hidden"
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="glass-strong fixed inset-y-3 right-3 z-[60] w-72 rounded-[1.75rem] p-4 xl:hidden"
            >
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 opacity-60 hover:opacity-100"
              >
                <X size={18} />
              </button>
              <SessionList
                sessions={sessions}
                activeId={sessionId}
                onSelect={loadSession}
                onRename={(s) => { setRenameTarget(s); setRenameValue(s.title) }}
                onDelete={setDeleteTarget}
                onNew={newConversation}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Chat column */}
      <GlassCard className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-forest-900/10 px-5 py-3.5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <Logo size={32} />
            <div>
              <div className="font-display text-sm font-extrabold">Thesis AI Chat</div>
              <div className="text-[0.65rem] opacity-50">
                Grounded in the {filterDepartment === 'all' ? 'university' : filterDepartment} archive · citations included
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              className="h-9 w-full sm:w-auto"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </Select>
            {user ? (
              <Button variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setSidebarOpen(true)} aria-label="Conversations">
                <History size={16} />
              </Button>
            ) : (
              <Button variant="gold" size="sm" onClick={() => navigate('/login')}>
                <GraduationCap size={14} /> Sign in to save chats
              </Button>
            )}
          </div>
        </div>

        {/* Guest banner */}
        {!user && (
          <div className="flex items-center gap-2 bg-gold-400/12 px-5 py-2 text-xs font-medium text-gold-700 dark:text-gold-300">
            <Info size={13} className="shrink-0" />
            You're in guest mode — conversations are not saved.
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.length === 0 && !sending ? (
            <div className="flex h-full flex-col items-center justify-center">
              <EmptyState
                icon={Sparkles}
                title="Ask the archive anything"
                message={`Semantic search across every indexed ${filterDepartment === 'all' ? 'university' : filterDepartment} thesis — methodologies, scopes, findings, and related literature.`}
              />
              <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {STARTERS.map((s, i) => (
                  <motion.button
                    key={s}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 + i * 0.08 }}
                    onClick={() => send(s)}
                    className="glass state-layer rounded-2xl px-4 py-3 text-left text-xs font-medium leading-relaxed opacity-80 transition hover:opacity-100"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.kind === 'user'
                ? <UserBubble key={i} text={m.text} />
                : <AiBubble key={i} message={m} animate={m.isNew} />,
            )
          )}
          <AnimatePresence>{sending && <TypingIndicator />}</AnimatePresence>
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-forest-900/10 p-4 dark:border-white/10">
          <form
            onSubmit={(e) => { e.preventDefault(); send() }}
            className="glass flex items-end gap-2 rounded-[1.4rem] p-2"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder={`Ask about ${filterDepartment === 'all' ? 'university' : filterDepartment} thesis research…`}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:opacity-45"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="shrink-0"
            >
              <Send size={17} />
            </Button>
          </form>
          <p className="mt-2 text-center text-[0.65rem] opacity-40">
            Answers are synthesized exclusively from archived {filterDepartment === 'all' ? 'university' : filterDepartment} theses. Topics ≥85% similar to existing work are flagged automatically.
          </p>
        </div>
      </GlassCard>

      {/* Rename modal */}
      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename conversation" size="sm">
        <form onSubmit={(e) => { e.preventDefault(); submitRename() }}>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={120}
          />
          <div className="mt-5 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={submitDelete}
        title="Delete conversation?"
        message={`"${deleteTarget?.title}" and all of its messages will be permanently removed.`}
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </PageTransition>
  )
}
