import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import {
  Send, Plus, MessageSquareText, Trash2, PencilLine,
  AlertTriangle, BookMarked, History, Info, GraduationCap, Loader2, Square, X,
  Copy, Check,
} from 'lucide-react'
import {
  chatQuery, getSessions, getSessionMessages, renameSession, deleteSession, apiErrorMessage, getDepartments, getPublicSettings
} from '../api'
import { SecurityCheck } from '../components/security/SecurityCheck'
import { useGuestChatGate } from './chat/useGuestChatGate'
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
import { getChatPrefs } from '../lib/chatPrefs'
import { THESIS_CATEGORIES } from '../lib/catalog'

const STARTERS = [
  'What machine learning techniques were used in past CCSICT theses?',
  'Are there existing studies about attendance monitoring systems?',
  'Summarize local research on network security for campus networks.',
  'Has anyone built a recommendation system in the Data Mining track?',
]

// Messages need an identity that survives the list being trimmed on error or
// stop, which an array index does not: React would otherwise reuse a bubble's
// state and entry animation for whichever message slid into that position.
let messageSequence = 0
const nextMessageId = () => {
  messageSequence += 1
  return `msg-${messageSequence}`
}

function isCancelledRequest(error) {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError'
}

function ComposerAction({ sending, verifying, hasInput, onStop }) {
  if (sending) {
    return (
      <Button
        type="button"
        variant="danger"
        size="icon"
        aria-label="Stop waiting for response"
        className="shrink-0"
        onClick={onStop}
      >
        <Square size={15} fill="currentColor" />
      </Button>
    )
  }
  if (verifying) {
    return (
      <Button type="button" size="icon" disabled aria-label="Waiting for the security check" className="shrink-0">
        <Loader2 size={16} className="animate-spin" />
      </Button>
    )
  }
  return (
    <Button type="submit" size="icon" disabled={!hasInput} aria-label="Send" className="shrink-0">
      <Send size={17} />
    </Button>
  )
}

// A failed or unsupported check must not leave the composer spinning forever —
// the gate panel explains the problem and offers a retry instead.
function isVerifyingSend(awaiting, gateStatus) {
  return awaiting && gateStatus !== 'error' && gateStatus !== 'unsupported'
}

/**
 * The check gates sending, so it belongs with the composer rather than at the
 * top of the page, and it stays silent unless it actually needs the visitor.
 */
function GuestGate({ gate, awaiting, onStatus }) {
  if (!gate.armed) return null
  return (
    <SecurityCheck
      action="guest_chat"
      onToken={gate.acceptToken}
      onStatusChange={onStatus}
      resetKey={gate.resetKey}
      quiet={!awaiting}
      className="mb-3"
      title="Confirm you're human to send"
      description={
        awaiting
          ? 'Your question sends automatically as soon as this clears.'
          : 'One check unlocks guest chat for the rest of your session.'
      }
    />
  )
}

function Composer({
  value, onChange, onSend, onFocus, placeholder, footnote,
  sending, verifying, onStop, textareaRef, sendKey, children,
}) {
  return (
    <div className="border-t border-forest-900/10 p-4 dark:border-white/10">
      {children}
      <form
        onSubmit={(e) => { e.preventDefault(); onSend() }}
        className="glass flex items-end gap-2 rounded-[1.4rem] p-2"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={(e) => {
            // sendKey preference from Settings → Chat & AI: default Enter sends
            // (Shift+Enter newlines); 'ctrlEnter' flips it so Enter newlines and
            // only Ctrl/Cmd+Enter sends.
            const shouldSend = sendKey === 'ctrlEnter'
              ? e.key === 'Enter' && (e.ctrlKey || e.metaKey)
              : e.key === 'Enter' && !e.shiftKey
            if (shouldSend) { e.preventDefault(); onSend() }
          }}
          className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:opacity-45"
        />
        <ComposerAction
          sending={sending}
          verifying={verifying}
          hasInput={Boolean(value.trim())}
          onStop={onStop}
        />
      </form>
      <p className="mt-2 text-center text-xs text-ink-faint">{footnote}</p>
    </div>
  )
}

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
            className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-gold-400/20 px-1.5 font-mono text-xs font-bold text-gold-text dark:text-gold-300"
          >
            {citationId}
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-snug">{source.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
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
                <div key={`${item.chunk_id}-${citationId}`} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono font-bold text-gold-text dark:text-gold-300">[{citationId}]</span>
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
          <div className="mt-1.5 text-xs italic text-ink-faint">
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
          <div className="mt-0.5 text-xs text-ink-muted">
            {alert.matched_paper?.authors}
            {alert.matched_paper?.year ? ` · ${alert.matched_paper.year}` : ''}
            {alert.matched_paper?.track ? ` · ${alert.matched_paper.track}` : ''}
          </div>
        </div>
        {alert.summary && (
          <p className="text-xs leading-relaxed text-ink-muted">
            <span className="font-semibold">About the matched study: </span>
            {alert.summary}
          </p>
        )}
        <p className="text-xs italic text-ink-muted">
          Consider building upon this work rather than duplicating it — discuss with your faculty adviser.
        </p>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Message bubbles                                                     */
/* ------------------------------------------------------------------ */
/** Google Fonts (Material Symbols) "edit" glyph as inline SVG — same technique
    as AuthFx's GoogleIcon, so no icon webfont is shipped for this one glyph. */
const MATERIAL_EDIT_PATH =
  'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 ' +
  '0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'

function MaterialEditIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={MATERIAL_EDIT_PATH} />
    </svg>
  )
}

/** Google/Gemini-style icon action: the label appears as a small dark tooltip
    pill below the icon on hover (and on keyboard focus), with a short delay. */
function PromptAction({ label, onClick, children }) {
  return (
    <span className="group/prompt-action relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-forest-900/8 hover:text-forest-700 dark:hover:bg-white/10 dark:hover:text-forest-300"
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-20 mt-1 -translate-x-1/2 rounded-lg bg-[#20221f]/95 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-150 delay-300 group-hover/prompt-action:opacity-100 group-hover/prompt-action:delay-500 group-focus-within/prompt-action:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}

function UserBubble({ text, onCopy, onUpdate, copied }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const editRef = useRef(null)

  useEffect(() => {
    if (editing && editRef.current) {
      // Focus at the end of the existing text — no select-all, matching
      // Gemini's edit card where the cursor simply lands after the prompt.
      const el = editRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing])

  // Content-sized card: the textarea hugs its text and grows with it instead
  // of opening a large fixed box. scrollHeight drives the row count.
  useEffect(() => {
    const el = editRef.current
    if (!editing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, editing])

  const startEdit = () => {
    setDraft(text)
    setEditing(true)
  }
  const cancelEdit = () => {
    setDraft(text)
    setEditing(false)
  }
  const submitEdit = () => {
    const updated = draft.trim()
    if (!updated) return
    setEditing(false)
    onUpdate(updated)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      className="flex justify-end"
    >
      <div className="max-w-[85%] sm:max-w-[70%]">
        {editing ? (
          <div className="min-w-64 rounded-[1.4rem] border border-forest-500/70 bg-forest-950/[0.03] px-4 pt-3 pb-2 sm:min-w-80 dark:bg-white/[0.03]">
            <textarea
              ref={editRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                if (e.key === 'Escape') cancelEdit()
              }}
              aria-label="Edit prompt text"
              className="block max-h-40 w-full resize-none overflow-y-auto bg-transparent text-sm leading-relaxed outline-none"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={!draft.trim()} onClick={submitEdit}>
                Update
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-3xl rounded-br-lg bg-gradient-to-br from-forest-600 to-forest-800 px-5 py-3 text-sm leading-relaxed text-white shadow-lg shadow-forest-900/20">
              {text}
            </div>
            <div className="mt-1.5 flex justify-end gap-1">
              <PromptAction
                label={copied ? 'Copied' : 'Copy prompt'}
                onClick={onCopy}
              >
                {copied ? <Check size={13} className="text-forest-600" /> : <Copy size={13} />}
              </PromptAction>
              <PromptAction label="Edit prompt" onClick={startEdit}>
                <MaterialEditIcon />
              </PromptAction>
            </div>
          </>
        )}
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
          {message.archive_current && (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-forest-700 dark:text-forest-300">
              <BookMarked size={12} aria-hidden="true" /> Searched the current indexed archive
            </div>
          )}
          {message.no_relevant_thesis && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-gold-400/10 px-3 py-2 text-xs font-medium text-gold-text dark:text-gold-300">
              <Info size={13} className="shrink-0" />
              Search completed · no qualifying archive evidence.
            </div>
          )}
        </div>
        {message.sources?.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider text-ink-faint">
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
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-faint">
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
                  <span className="block text-xs text-ink-faint">
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
          <p className="px-3 py-6 text-center text-xs text-ink-faint">
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
  // Content scope, not a security boundary: every visitor (guests included)
  // may narrow retrieval to student or faculty theses. Starts from the default
  // chosen in Settings → Chat & AI.
  const [filterCategory, setFilterCategory] = useState(() => getChatPrefs().defaultCategory)
  const [sendKey] = useState(() => getChatPrefs().sendKey)
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [awaitingCheck, setAwaitingCheck] = useState(false)
  const [gateStatus, setGateStatus] = useState('pending')
  const [copiedMessageId, setCopiedMessageId] = useState(null)
  const copiedMessageTimeoutRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const requestControllerRef = useRef(null)
  const pendingQuestionRef = useRef('')
  const sendRef = useRef(null)
  const awaitingCheckRef = useRef(false)
  // Runs from Turnstile's own callback, so it fires the parked question the
  // instant the token exists rather than a render later.
  const releaseParkedSend = useCallback(() => {
    if (!awaitingCheckRef.current) return
    awaitingCheckRef.current = false
    setAwaitingCheck(false)
    sendRef.current?.()
  }, [])
  const guestGate = useGuestChatGate(user, { onVerified: releaseParkedSend })
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

  useEffect(() => () => {
    requestControllerRef.current?.abort('unmount')
    clearTimeout(copiedMessageTimeoutRef.current)
  }, [])

  const copyPrompt = async (message) => {
    try {
      await navigator.clipboard.writeText(message.text)
    } catch {
      const helper = document.createElement('textarea')
      helper.value = message.text
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      document.body.removeChild(helper)
    }
    clearTimeout(copiedMessageTimeoutRef.current)
    setCopiedMessageId(message.id)
    copiedMessageTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 1600)
  }

  const updatePrompt = (original, updated) => {
    const controller = requestControllerRef.current
    const wasPending = controller && pendingQuestionRef.current === original.text
    if (wasPending) {
      controller.abort('edit-prompt')
      requestControllerRef.current = null
      pendingQuestionRef.current = ''
      setSending(false)
      setChatError(null)
    }
    if (updated === original.text && !wasPending) return
    send(updated)
  }

  const loadSession = async (session) => {
    setSessionId(session.id)
    if (isSuperadmin && session.department) setFilterDepartment(session.department)
    setSidebarOpen(false)
    try {
      const msgs = await getSessionMessages(session.id)
      const rebuilt = []
      msgs.forEach((m) => {
        rebuilt.push({ id: nextMessageId(), kind: 'user', text: m.question })
        rebuilt.push({
          id: nextMessageId(),
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
    requestControllerRef.current?.abort('conversation-reset')
    clearTimeout(copiedMessageTimeoutRef.current)
    setCopiedMessageId(null)
    requestControllerRef.current = null
    pendingQuestionRef.current = ''
    awaitingCheckRef.current = false
    setAwaitingCheck(false)
    setSending(false)
    setSessionId(null)
    setMessages([])
    setChatError(null)
    setFilterCategory(getChatPrefs().defaultCategory)
    setSidebarOpen(false)
    inputRef.current?.focus()
  }

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || requestControllerRef.current) return
    // Guests wait on a one-time check. Park the question in the composer so it
    // stays visible and editable; the gate fires it the moment the token lands,
    // which is usually before the visitor notices.
    if (!guestGate.isReady()) {
      guestGate.arm()
      setInput(question)
      awaitingCheckRef.current = true
      setAwaitingCheck(true)
      setChatError(null)
      return
    }
    awaitingCheckRef.current = false
    setAwaitingCheck(false)
    setInput('')
    setChatError(null)
    setMessages((m) => [...m, { id: nextMessageId(), kind: 'user', text: question }])
    setSending(true)
    const controller = new AbortController()
    requestControllerRef.current = controller
    pendingQuestionRef.current = question
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
          .slice(0, 10) || []
      const res = await chatQuery(
        question,
        sessionId,
        isSuperadmin ? filterDepartment || null : null,
        guestHistory,
        latestGuestSources,
        controller.signal,
        guestGate.tokenForRequest(),
        filterCategory || null,
      )
      if (controller.signal.aborted) return
      guestGate.markPassed()
      // `kind` is this list's own 'user' | 'ai' role and must outlive the spread.
      // The API has its own `kind` concept now (chat_messages.kind, B14), so a
      // response field of that name would otherwise overwrite the role and
      // break every render that branches on it.
      setMessages((m) => [...m, { id: nextMessageId(), ...res, kind: 'ai', isNew: true }])
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
      const cancelled = isCancelledRequest(err)
      if (cancelled) return
      setMessages((m) => m.slice(0, -1))
      setInput(question)
      guestGate.handleChatError(err)
      const message = apiErrorMessage(err)
      setChatError({ title: 'IskAI could not answer', message, question })
      toast.error('IskAI could not answer', { description: message })
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
        pendingQuestionRef.current = ''
        setSending(false)
      }
    }
  }

  // Kept in a ref so `releaseParkedSend` can invoke the current closure without
  // being rebuilt on every keystroke.
  useEffect(() => {
    sendRef.current = send
  })

  const stopWaiting = () => {
    const controller = requestControllerRef.current
    const question = pendingQuestionRef.current
    if (!controller || !question) return
    controller.abort('user-stop')
    requestControllerRef.current = null
    pendingQuestionRef.current = ''
    setMessages((current) => (
      current[current.length - 1]?.kind === 'user' ? current.slice(0, -1) : current
    ))
    setChatError({
      title: 'Response stopped',
      message: 'The question is preserved here. The browser stopped waiting, while any secure server cleanup may continue.',
      question,
    })
    setSending(false)
    toast.info('Response stopped')
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
              <h1 className="font-display text-sm font-extrabold">IskAI</h1>
              <div className="truncate text-xs text-ink-faint">
                Grounded in the {effectiveDepartment} archive · citations included
              </div>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="h-9 min-w-0 flex-1 sm:w-auto sm:flex-none"
              aria-label="Filter research by thesis category"
            >
              <option value="">All categories</option>
              {THESIS_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </Select>
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
          <div className="flex items-center gap-2 border-b border-gold-400/20 bg-gold-400/[0.09] px-4 py-2 text-xs font-medium text-gold-800 dark:text-gold-200 sm:px-5">
            <Info size={12} className="shrink-0 opacity-70" aria-hidden="true" />
            <span className="min-w-0 truncate">
              <span className="font-bold">Guest Researcher</span>
              {/* The banner's gold-on-tint is 7.8:1; de-emphasising this half with
                  opacity dragged it to 3.8:1, so the weight difference carries it. */}
              <span className="font-normal"> · {effectiveDepartment} archive only · chats aren't saved</span>
            </span>
          </div>
        )}
        <ConfigurationWarning show={settingsError || (isSuperadmin && departmentsError)} />
        {chatError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-flame-500/20 bg-flame-500/8 px-5 py-3 text-xs">
            <AlertTriangle size={15} className="shrink-0 text-flame-500" />
            <div className="min-w-0 flex-1">
              <div className="font-bold">{chatError.title}</div>
              <div className="mt-0.5 opacity-65">{chatError.message}</div>
              <div className="mt-1 truncate font-medium">“{chatError.question}”</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setInput(chatError.question)
                setChatError(null)
                inputRef.current?.focus()
              }}
            >
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => send(chatError.question)}>Retry</Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setChatError(null)} aria-label="Dismiss chat error">
              <X size={14} />
            </Button>
          </div>
        )}

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
            messages.map((m) =>
              m.kind === 'user'
                ? (
                  <UserBubble
                    key={m.id}
                    text={m.text}
                    copied={copiedMessageId === m.id}
                    onCopy={() => copyPrompt(m)}
                    onUpdate={(updated) => updatePrompt(m, updated)}
                  />
                )
                : <AiBubble key={m.id} message={m} animate={m.isNew} />,
            )
          )}
          {isAwaitingAnswer && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          // Warm the check up front so the token is ready before they finish typing.
          onFocus={guestGate.arm}
          textareaRef={inputRef}
          sendKey={sendKey}
          placeholder={`Ask IskAI about ${effectiveDepartment} thesis research…`}
          sending={sending}
          verifying={isVerifyingSend(awaitingCheck, gateStatus)}
          onStop={stopWaiting}
          footnote={`Answers are synthesized exclusively from archived ${effectiveDepartment} theses. Topics ≥85% similar to existing work are flagged for faculty review.`}
        >
          <GuestGate gate={guestGate} awaiting={awaitingCheck} onStatus={setGateStatus} />
        </Composer>
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
