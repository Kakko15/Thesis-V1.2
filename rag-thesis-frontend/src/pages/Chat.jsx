import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import {
  Send, Plus, MessageSquareText, Trash2, PencilLine,
  AlertTriangle, BookMarked, History, Info, GraduationCap,
} from 'lucide-react'
import {
  chatQuery, getSessions, getSessionMessages, renameSession, deleteSession, apiErrorMessage, getDepartments, getPublicSettings
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
import { AnimatedLogo } from '../components/ui/AnimatedLogo'
import { LogoActivityDots } from '../components/ui/LogoActivityDots'
import { Sheet } from '../components/ui/Sheet'
import { cn, normalizePercent, timeAgo } from '../lib/utils'

const STARTERS = [
  'What machine learning techniques were used in past CCSICT theses?',
  'Are there existing studies about attendance monitoring systems?',
  'Summarize local research on network security for campus networks.',
  'Has anyone built a recommendation system in the Data Mining track?',
]

function ConfigurationWarning({ show }) {
  if (!show) return null
  return (
    <div role="alert" className="flex items-center gap-2 bg-flame-500/10 px-5 py-2 text-xs text-flame-500">
      <AlertTriangle size={13} /> Some archive configuration is unavailable; enforced defaults are being used.
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Citation source card                                                */
/* ------------------------------------------------------------------ */
function pageLabelFor(source) {
  if (!source.page_start) return null
  return source.page_end && source.page_end !== source.page_start
    ? `pp. ${source.page_start}–${source.page_end}`
    : `p. ${source.page_start}`
}

function groupEvidenceSources(sources = []) {
  const groups = new Map()
  sources.forEach((source) => {
    const key = source.id || `citation-${source.citation_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(source)
  })
  return [...groups.values()]
}

function SourceCard({ sources, index }) {
  const source = sources[0]
  const citationIds = sources.map((item, itemIndex) => item.citation_id ?? itemIndex + 1)
  const evidenceSources = sources.filter((item) => item.chunk_id != null)
  const locationPending = evidenceSources.some(
    (item) => !pageLabelFor(item) && !item.section,
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.08, duration: 0.4 }}
      className="glass flex w-full items-start gap-3 rounded-2xl p-3.5 text-left"
    >
      <div className="flex max-w-16 shrink-0 flex-wrap gap-1">
        {citationIds.map((citationId) => (
          <div
            key={citationId}
            className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-gold-400/20 px-1.5 font-mono text-xs font-bold text-gold-600 dark:text-gold-300"
          >
            {citationId}
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-snug">{source.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-60">
          {source.authors && <span>{source.authors}</span>}
          {source.year && <span>· {source.year}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {source.department && <Badge tone="neutral">{source.department}</Badge>}
          {source.track && <Badge tone="forest">{source.track}</Badge>}
        </div>
        {evidenceSources.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-forest-900/10 pt-2.5 dark:border-white/10">
            {evidenceSources.map((item, itemIndex) => {
              const citationId = item.citation_id ?? itemIndex + 1
              const pageLabel = pageLabelFor(item)
              return (
                <div key={`${item.chunk_id}-${citationId}`} className="flex flex-wrap items-center gap-1.5 text-[0.68rem]">
                  <span className="font-mono font-bold text-gold-600 dark:text-gold-300">[{citationId}]</span>
                  {Number.isInteger(item.chunk_index) && <span>Chunk {item.chunk_index + 1}</span>}
                  {pageLabel && <Badge tone="neutral">{pageLabel}</Badge>}
                  {item.section && <span className="opacity-60">{item.section}</span>}
                  {typeof item.similarity === 'number' && (
                    <span className="opacity-50">{normalizePercent(item.similarity).toFixed(2)}% match</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {locationPending && (
          <div className="mt-1.5 text-[0.65rem] italic opacity-45">
            Some evidence locations are pending citation backfill.
          </div>
        )}
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
          Potential topic duplication — {normalizePercent(alert.similarity).toFixed(2)}% similarity
        </div>
      </div>
      <div className="space-y-2.5 px-4 py-3.5 text-sm">
        <p className="opacity-80">
          This topic meets the {normalizePercent(alert.threshold).toFixed(2)}% cosine-similarity duplication threshold against an
          archived {alert.matched_paper?.department || 'department'} study:
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

function AiAvatar() {
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center"
    >
      <Logo size={40} />
    </div>
  )
}

function AiBubble({ message, animate }) {
  const groupedSources = groupEvidenceSources(message.sources)
  return (
    <div className="flex gap-3">
      <AiAvatar />
      <motion.div
        initial={animate ? { opacity: 0, filter: 'blur(4px)' } : false}
        animate={{ opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
        className="min-w-0 max-w-full flex-1 sm:max-w-[85%]"
      >
        <div className="glass rounded-3xl rounded-tl-lg px-5 py-4">
          <div className="prose-chat">
            <ReactMarkdown>{message.answer}</ReactMarkdown>
          </div>
          {message.no_relevant_thesis && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 text-xs font-medium text-gold-600 dark:text-gold-300">
              <Info size={13} className="shrink-0" />
              Search completed · no qualifying archive evidence.
            </div>
          )}
        </div>
        {message.sources?.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider opacity-50">
              <BookMarked size={12} /> Evidence sources
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {groupedSources.map((group, i) => (
                <SourceCard key={group[0].id || i} sources={group} index={i} />
              ))}
            </div>
          </div>
        )}
        <DuplicationBanner alert={message.duplication_alert} />
      </motion.div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex h-10 items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label="IskAI is searching the thesis archive"
    >
      <AnimatedLogo size={40} />
      <LogoActivityDots />
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Session sidebar                                                     */
/* ------------------------------------------------------------------ */
function SessionList({ sessions, activeId, onSelect, onRename, onDelete, onNew, error, onRetry }) {
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
                'group flex items-center gap-1 rounded-2xl px-2 py-1.5 transition-colors duration-200',
                activeId === s.id
                  ? 'bg-forest-600/12 dark:bg-forest-400/12'
                  : 'hover:bg-forest-900/6 dark:hover:bg-white/6',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(s)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left"
              >
                <MessageSquareText size={14} className="shrink-0 opacity-50" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block text-[0.65rem] opacity-45">
                    {s.department || 'CCSICT'} · {timeAgo(s.created_at)}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 gap-0.5">
                <button
                  type="button"
                  onClick={() => onRename(s)}
                  aria-label={`Rename ${s.title}`}
                  className="rounded-lg p-1.5 opacity-50 hover:bg-forest-900/10 hover:opacity-100 dark:hover:bg-white/10"
                >
                  <PencilLine size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(s)}
                  aria-label={`Delete ${s.title}`}
                  className="rounded-lg p-1.5 text-flame-500 opacity-50 hover:bg-flame-500/10 hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {error ? (
          <div role="alert" className="px-3 py-6 text-center text-xs">
            <p className="text-flame-500">Conversations are unavailable.</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>Retry</Button>
          </div>
        ) : sessions.length === 0 && (
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
  const { user, isSuperadmin, department: userDepartment } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [messages, setMessages] = useState([]) // {kind:'user'|'ai', ...}
  const [input, setInput] = useState('')
  const [filterDepartment, setFilterDepartment] = useState('')
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const isAwaitingAnswer = sending && messages[messages.length - 1]?.kind === 'user'
  const { data: publicSettings, isError: settingsError } = useQuery({
    queryKey: ['public-settings'],
    queryFn: getPublicSettings,
    staleTime: Infinity,
  })
  const evaluationDepartment = publicSettings?.evaluation_department || 'CCSICT'
  const effectiveDepartment = isSuperadmin
    ? (filterDepartment || userDepartment || evaluationDepartment)
    : (user ? userDepartment : evaluationDepartment)

  const {
    data: sessions = [],
    isError: sessionsError,
    refetch: retrySessions,
  } = useQuery({
    queryKey: ['sessions'],
    queryFn: getSessions,
    enabled: !!user,
  })

  const { data: departments = [], isError: departmentsError } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
    enabled: isSuperadmin,
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const loadSession = async (session) => {
    setSessionId(session.id)
    if (isSuperadmin && session.department) setFilterDepartment(session.department)
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
      const guestHistory = user
        ? []
        : messages
          .filter((message) => message.kind === 'user')
          .slice(-5)
          .map((message) => message.text)
      const latestGuestSources = user
        ? []
        : [...messages]
          .reverse()
          .find((message) => message.kind === 'ai' && message.sources?.length)
          ?.sources
          .map((source) => source.id)
          .filter((id, index, ids) => id && ids.indexOf(id) === index)
          .slice(0, 5) || []
      const res = await chatQuery(
        question,
        sessionId,
        isSuperadmin ? filterDepartment || null : null,
        guestHistory,
        latestGuestSources,
      )
      setMessages((m) => [...m, { kind: 'ai', ...res, isNew: true }])
      if (user && res.history_saved === false) {
        toast.warning('Answer received, but chat history was not saved', {
          description: 'Copy anything important and try again after the archive connection recovers.',
        })
      }
      if (res.session_id && res.session_id !== sessionId) {
        setSessionId(res.session_id)
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }
    } catch (err) {
      toast.error('IskAI could not answer', { description: apiErrorMessage(err) })
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
    <PageTransition className="mx-auto flex h-[calc(100dvh-10.5rem)] max-w-6xl gap-4 md:h-[calc(100vh-3rem)]">
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
            error={sessionsError}
            onRetry={retrySessions}
          />
        </GlassCard>
      )}

      {/* Mobile session drawer */}
      <Sheet
        open={Boolean(user && sidebarOpen)}
        onClose={() => setSidebarOpen(false)}
        title="Conversations"
        className="w-72"
        responsiveClass="xl:hidden"
      >
        <SessionList
          sessions={sessions}
          activeId={sessionId}
          onSelect={loadSession}
          onRename={(s) => { setRenameTarget(s); setRenameValue(s.title) }}
          onDelete={setDeleteTarget}
          onNew={newConversation}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </Sheet>

      {/* Chat column */}
      <GlassCard className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-forest-900/10 px-4 py-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size={32} />
            <div className="min-w-0">
              <div className="font-display text-sm font-extrabold">IskAI</div>
              <div className="truncate text-[0.65rem] opacity-50">
                Grounded in the {effectiveDepartment} archive · citations included
              </div>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {isSuperadmin ? (
              <Select
                value={filterDepartment}
                onChange={(e) => {
                  setFilterDepartment(e.target.value)
                  newConversation()
                }}
                className="h-9 min-w-0 flex-1 sm:w-auto sm:flex-none"
                aria-label="Filter research by department"
              >
                <option value="">Default ({userDepartment || evaluationDepartment})</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </Select>
            ) : (
              <Badge tone="neutral">{effectiveDepartment}</Badge>
            )}
            {user ? (
              <Button variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setSidebarOpen(true)} aria-label="Conversations">
                <History size={16} />
              </Button>
            ) : (
              <Button variant="gold" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => navigate('/login')}>
                <GraduationCap size={14} /> Sign in to save chats
              </Button>
            )}
          </div>
        </div>

        {/* Guest banner */}
        {!user && (
          <div className="flex items-center gap-2 bg-gold-400/12 px-5 py-2 text-xs font-medium text-gold-700 dark:text-gold-300">
            <Info size={13} className="shrink-0" />
            You're in Guest Researcher mode — CCSICT only, and conversations are not saved.
          </div>
        )}
        <ConfigurationWarning show={settingsError || (isSuperadmin && departmentsError)} />

        {/* Messages */}
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.length === 0 && !sending ? (
            <div className="flex h-full flex-col items-center justify-center">
              <EmptyState
                icon={Logo}
                title="Ask IskAI anything"
                message={`Semantic search across indexed ${effectiveDepartment} theses — methodologies, scopes, findings, and related literature.`}
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
          {isAwaitingAnswer && <TypingIndicator />}
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
              placeholder={`Ask IskAI about ${effectiveDepartment} thesis research…`}
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
            Answers are synthesized exclusively from archived {effectiveDepartment} theses. Topics ≥85% similar to existing work are flagged for faculty review.
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
