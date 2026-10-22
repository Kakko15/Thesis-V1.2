import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import { ClipboardList, Download, FileText, Info } from 'lucide-react'
import { scanDuplicationChat, apiErrorMessage } from '../../api'
import { Button } from '../../components/ui/Button'
import { ProgressRing } from '../../components/ui/ProgressRing'
import { cn, normalizePercent, scanMetrics, timeAgo, verdictLabel, verdictTone } from '../../lib/utils'
import { contentKeys } from '../../lib/keys'
import { downloadNoveltyReport } from './report'
import { isCapsuleScan } from './capsule'

/** Google Fonts (Material Symbols Outlined: arrow_upward_alt, fill 0 / wght 400 / opsz 24). */
const ARROW_UPWARD_ALT_PATH =
  'M440-240v-368L296-464l-56-56 240-240 240 240-56 56-144-144v368h-80Z'

function ArrowUpwardAltIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true" className={className}>
      <path d={ARROW_UPWARD_ALT_PATH} />
    </svg>
  )
}

const VERDICT_CHIP = {
  critical: 'bg-flame-500/12 text-flame-700 dark:text-flame-200',
  warning: 'bg-gold-400/20 text-gold-text dark:text-gold-200',
  neutral: 'bg-[var(--primary-container)] text-[var(--primary-container-foreground)]',
}

const TABS = [
  { id: 'matches', label: 'Matches', capsuleLabel: 'Sections' },
  { id: 'explanation', label: 'Explanation' },
  { id: 'ask', label: 'Ask' },
]

/**
 * A capsule's sections, each with the archived thesis it is closest to.
 *
 * A proposal's reviewer wants "what does this resemble" even where nothing is
 * flagged, so every section is listed: flagged ones carry a chip, close ones
 * show their nearest thesis, and the rest say plainly that nothing is close.
 */
function CapsuleSections({ sections }) {
  return (
    <ul className="-mx-5 divide-y divide-[var(--border)] sm:-mx-6" aria-label="Capsule sections">
      {sections.map((row) => (
        <li key={row.key} className="flex items-start gap-3 px-5 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{row.label}</span>
              {row.flagged && (
                <span className="rounded-full bg-flame-500/12 px-2 py-0.5 text-[11px] font-semibold text-flame-700 dark:text-flame-200">
                  Flagged
                </span>
              )}
            </div>
            {row.closest ? (
              <p className="mt-0.5 truncate text-xs text-ink-muted" title={row.closest.title}>
                {row.basis === 'wording' ? 'Worded like ' : 'Closest to '}
                <span className="font-medium text-ink">{row.closest.title}</span>
                {row.closest.year ? ` · ${row.closest.year}` : ''}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-ink-muted">No archived thesis is closely similar.</p>
            )}
          </div>
          {row.closest && (
            <span className="shrink-0 font-display text-sm font-bold tabular-nums">
              {normalizePercent(row.similarity).toFixed(1)}%
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * One scan's advisory report, as a single outlined card with tabs.
 *
 * The report used to be four stacked cards -- a 150 px ring beside a grid of
 * five boxed figures, then the full AI write-up, then the interpretation note,
 * then the follow-up chat -- so reading one scan meant scrolling past all of
 * them, and a batch put the list of manuscripts a full page above its report.
 * The figures are now one inline row under the verdict, and the three long
 * parts are tabs, the way Google's own consoles separate a summary from its
 * detail. The tab resets per scan because the component is keyed on scan id.
 */
export function ScanReport({ scan, onAsk }) {
  const [tab, setTab] = useState('matches')
  const [question, setQuestion] = useState('')
  const [chatLog, setChatLog] = useState(scan.chat_log || [])
  const [asking, setAsking] = useState(false)
  const rootRef = useRef(null)
  const tabRefs = useRef({})
  // The server returns the whole log and trims it to the newest 20, so entries
  // shift position. Content-derived keys follow an entry across that shift.
  const chatLogKeys = contentKeys(chatLog.map((m) => `${m.role}|${m.content}`), 'novelty-chat')

  // Opening a report from a batch row or the history list used to leave it a
  // screen below, unseen. Bring its top into view, unless it already is.
  useEffect(() => {
    const node = rootRef.current
    if (!node?.getBoundingClientRect || !node.scrollIntoView) return
    const { top } = node.getBoundingClientRect()
    if (top < 0 || top > window.innerHeight * 0.6) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    }
  }, [])

  const ask = async (e) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setQuestion('')
    setChatLog((log) => [...log, { role: 'user', content: q }])
    setAsking(true)
    try {
      const res = await scanDuplicationChat(scan.id, q)
      setChatLog(res.chat_log)
      onAsk?.()
    } catch (err) {
      toast.error('Question failed', { description: apiErrorMessage(err) })
      setChatLog((log) => log.slice(0, -1))
    } finally {
      setAsking(false)
    }
  }

  const onTabKey = (event) => {
    const index = TABS.findIndex((item) => item.id === tab)
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = TABS[(index + step + TABS.length) % TABS.length].id
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const metrics = scanMetrics(scan)
  const tone = verdictTone(metrics.verdict)
  const capsule = isCapsuleScan(scan)
  // A capsule is graded over its sections, so its figures name sections. The
  // coverage figure is left out: with four sections it only restates the
  // flagged count beside it.
  const figures = capsule ? [
    ['Closest single thesis', `${metrics.concentration.toFixed(2)}%`],
    ['Highest similarity', `${metrics.highest.toFixed(2)}%`],
    ['Sections flagged', `${metrics.matchedChunks} / ${metrics.totalChunks}`],
  ] : [
    // The graded figure first. Coverage stays, relabelled: on its own it reads
    // as an accusation, because a manuscript can match something everywhere and
    // still have no single archived thesis accounting for a tenth of it.
    ['Closest single thesis', `${metrics.concentration.toFixed(2)}%`],
    ['Highest passage', `${metrics.highest.toFixed(2)}%`],
    ['Matched anywhere', `${metrics.coverage.toFixed(2)}%`],
    ['Matched chunks', `${metrics.matchedChunks} / ${metrics.totalChunks}`],
  ]
  const matches = scan.top_matches || []

  return (
    <motion.section
      ref={rootRef}
      aria-label={`Novelty report for ${scan.filename}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
      className="scroll-mt-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-0)] dark:bg-[var(--surface-1)]"
    >
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-5 sm:px-6">
        {capsule
          ? <ClipboardList size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
          : <FileText size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" title={scan.filename}>{scan.filename}</h2>
          <p className="text-xs text-ink-muted">
            {capsule ? 'Capsule proposal · ' : ''}
            {timeAgo(scan.created_at)}{scan.department ? ` · ${scan.department}` : ''}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            downloadNoveltyReport(scan)
            toast.success('Metadata-only report downloaded')
          }}
        >
          <Download size={14} /> Download report
        </Button>
      </div>

      {/* Verdict and figures */}
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
        <div className="flex items-center gap-4">
          <ProgressRing value={metrics.concentration} size={96} strokeWidth={8} className="shrink-0" />
          <div className="min-w-0">
            <span className={cn('inline-flex rounded-full px-3 py-1 text-sm font-semibold', VERDICT_CHIP[tone] ?? VERDICT_CHIP.neutral)}>
              {verdictLabel(metrics.verdict)}
            </span>
            <p className="mt-1.5 text-xs text-ink-muted">
              {capsule ? "of this capsule's sections point at one archived thesis" : 'of this manuscript points at one archived thesis'}
            </p>
          </div>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-5 gap-y-3 border-t border-[var(--border)] pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          {figures.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate text-xs text-ink-muted" title={label}>{label}</dt>
              <dd className="font-display text-lg font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Report sections" className="flex border-b border-[var(--border)] px-3 sm:px-4" onKeyDown={onTabKey}>
        {TABS.map(({ id, label: baseLabel, capsuleLabel }) => {
          const selected = tab === id
          const label = capsule && capsuleLabel ? capsuleLabel : baseLabel
          const firstCount = capsule ? scan.capsule_sections.length : matches.length
          const count = id === 'matches' ? firstCount : id === 'ask' ? chatLog.length : 0
          return (
            <button
              key={id}
              ref={(node) => { tabRefs.current[id] = node }}
              type="button"
              role="tab"
              id={`scan-tab-${id}`}
              aria-selected={selected}
              aria-controls={`scan-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              className={cn(
                'state-layer relative -mb-px flex h-12 items-center gap-1.5 px-4 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                selected ? 'text-[var(--primary)]' : 'text-ink-muted hover:text-ink',
              )}
            >
              {label}
              {count > 0 && (
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[11px] font-semibold tabular-nums text-ink-muted dark:bg-[var(--surface-3)]">
                  {count}
                </span>
              )}
              {selected && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-[var(--primary)]" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`scan-panel-${tab}`}
        aria-labelledby={`scan-tab-${tab}`}
        className="px-5 py-4 sm:px-6"
      >
        {tab === 'matches' && (
          <>
            {capsule ? (
              <CapsuleSections sections={scan.capsule_sections} />
            ) : matches.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">No archived thesis reached the similarity threshold.</p>
            ) : (
              <ul className="-mx-5 divide-y divide-[var(--border)] sm:-mx-6" aria-label="Top matching studies">
                {matches.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" title={m.title}>{m.title}</div>
                      <div className="truncate text-xs text-ink-muted">
                        {m.authors}{m.year ? ` · ${m.year}` : ''}{m.track ? ` · ${m.track}` : ''}
                      </div>
                    </div>
                    <span className="shrink-0 font-display text-sm font-bold tabular-nums">
                      {normalizePercent(m.similarity).toFixed(2)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 flex items-start gap-2 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-ink-muted">
              <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
              {capsule
                ? 'A similarity advisory for a proposal: a short section can resemble an archived study without repeating it. The adviser and committee decide.'
                : 'A similarity advisory, not a plagiarism verdict; faculty review remains required. The downloaded report holds metadata only, never manuscript excerpts or reviewer chat.'}
            </p>
          </>
        )}

        {tab === 'explanation' && (
          <div className="prose-chat">
            <ReactMarkdown>{scan.verdict_summary || ''}</ReactMarkdown>
          </div>
        )}

        {tab === 'ask' && (
          <>
            <div className="mb-3 max-h-80 space-y-3 overflow-y-auto">
              {chatLog.length === 0 && (
                <p className="py-3 text-center text-xs text-ink-muted">
                  e.g. "Which chapter overlaps the most?" or "How can the student differentiate their study?"
                </p>
              )}
              {chatLog.map((m, i) => (
                <div key={chatLogKeys[i]} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      m.role === 'user'
                        ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                        : 'bg-[var(--surface-2)] dark:bg-[var(--surface-3)]',
                    )}
                  >
                    {m.role === 'user' ? m.content : (
                      <div className="prose-chat"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                    )}
                  </div>
                </div>
              ))}
              {asking && (
                <div className="flex items-center gap-1.5 pl-2" aria-label="The reviewer is answering">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
                      className="h-1.5 w-1.5 rounded-full bg-forest-500 dark:bg-gold-300"
                    />
                  ))}
                </div>
              )}
            </div>
            <form onSubmit={ask} className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-0)] p-1.5 pl-4 dark:bg-[var(--surface-2)]">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask the reviewer a follow-up…"
                aria-label="Ask the reviewer a follow-up"
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-muted"
              />
              <Button type="submit" size="icon-sm" disabled={!question.trim() || asking} aria-label="Send">
                <ArrowUpwardAltIcon size={16} />
              </Button>
            </form>
          </>
        )}
      </div>
    </motion.section>
  )
}
