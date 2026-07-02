import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'
import {
  ShieldCheck, FileSearch, FileText, X, History, Send,
  ArrowLeftRight, MessageSquareText, Sparkles, ScanSearch,
} from 'lucide-react'
import { scanDuplication, getScanHistory, scanDuplicationChat, apiErrorMessage } from '../api'
import { GlassCard } from '../components/ui/GlassCard'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ProgressRing } from '../components/ui/ProgressRing'
import { EmptyState } from '../components/ui/EmptyState'
import { PageTransition } from '../components/ui/Motion'
import { Skeleton } from '../components/ui/Skeleton'
import { cn, timeAgo } from '../lib/utils'

/* ------------------------------------------------------------------ */
function ScanDropzone({ onScan, scanning }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handle = useCallback((files) => {
    const f = files?.[0]
    if (!f) return
    if (f.size > 25 * 1024 * 1024) {
      toast.error('File too large', { description: 'Maximum size is 25 MB.' })
      return
    }
    onScan(f)
  }, [onScan])

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files) }}
      onClick={() => !scanning && inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed px-6 py-16 text-center transition-all duration-300',
        dragging
          ? 'border-gold-400 bg-gold-400/10 scale-[1.01]'
          : 'border-forest-700/25 hover:border-forest-600/50 dark:border-white/15 dark:hover:border-gold-400/40',
        scanning && 'pointer-events-none opacity-60',
      )}
    >
      <input ref={inputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => handle(e.target.files)} />
      {scanning ? (
        <>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl"
          >
            <ScanSearch size={26} className="text-gold-300" />
          </motion.div>
          <div className="font-display text-base font-bold">Scanning against the archive…</div>
          <p className="mt-1 max-w-xs text-xs opacity-55">
            Every chunk is embedded and compared at the 85% cosine-similarity threshold. This can take a minute for long drafts.
          </p>
        </>
      ) : (
        <>
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl shadow-forest-900/25">
            <FileSearch size={26} className="text-gold-300" />
          </div>
          <div className="font-display text-base font-bold">Drop a proposal or draft to scan</div>
          <p className="mt-1 text-xs opacity-55">PDF or TXT · compared chunk-by-chunk against every archived thesis</p>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
function ComparisonPairs({ pairs }) {
  if (!pairs?.length) return null
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider opacity-50">
        <ArrowLeftRight size={13} /> Matched excerpts (uploaded vs archived)
      </div>
      {pairs.map((p, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="glass overflow-hidden rounded-2xl"
        >
          <div className="flex items-center justify-between border-b border-forest-900/10 px-4 py-2 dark:border-white/10">
            <span className="text-xs font-bold opacity-60">Excerpt {i + 1}</span>
            <Badge tone={p.similarity >= 0.9 ? 'flame' : 'gold'}>
              {(p.similarity * 100).toFixed(1)}% similar
            </Badge>
          </div>
          <div className="grid divide-y divide-forest-900/10 dark:divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="p-4">
              <div className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-gold-500 dark:text-gold-300">
                Uploaded draft
              </div>
              <p className="max-h-36 overflow-y-auto text-xs leading-relaxed opacity-75">{p.uploaded_text}</p>
            </div>
            <div className="p-4">
              <div className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-forest-600 dark:text-forest-300">
                Archived thesis
              </div>
              <p className="max-h-36 overflow-y-auto text-xs leading-relaxed opacity-75">{p.database_text}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
function ScanResult({ scan, onAsk }) {
  const [question, setQuestion] = useState('')
  const [chatLog, setChatLog] = useState(scan.chat_log || [])
  const [asking, setAsking] = useState(false)

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

  const pct = scan.duplication_percentage ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
      className="space-y-5"
    >
      {/* Verdict header */}
      <GlassCard className="p-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <ProgressRing value={pct} label="duplication" size={150} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <FileText size={15} className="opacity-50" />
              <span className="truncate text-sm font-semibold">{scan.filename}</span>
              <Badge tone="neutral">{timeAgo(scan.created_at)}</Badge>
            </div>
            {scan.top_matches?.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider opacity-50">Top matching studies</div>
                {scan.top_matches.map((m) => (
                  <div key={m.id} className="glass flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{m.title}</div>
                      <div className="text-xs opacity-55">
                        {m.authors}{m.year ? ` · ${m.year}` : ''}{m.track ? ` · ${m.track}` : ''}
                      </div>
                    </div>
                    <Badge tone={m.similarity >= 90 ? 'flame' : 'gold'}>{m.similarity}%</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      {/* AI verdict */}
      <GlassCard className="p-6">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
          <Sparkles size={13} /> AI reviewer verdict
        </div>
        <div className="prose-chat">
          <ReactMarkdown>{scan.verdict_summary || ''}</ReactMarkdown>
        </div>
      </GlassCard>

      {/* Excerpt comparison */}
      {scan.matched_chunks?.length > 0 && (
        <GlassCard className="p-6">
          <ComparisonPairs pairs={scan.matched_chunks} />
        </GlassCard>
      )}

      {/* Follow-up chat */}
      <GlassCard className="p-6">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-50">
          <MessageSquareText size={13} /> Ask about this report
        </div>
        <div className="mb-4 max-h-72 space-y-3 overflow-y-auto">
          {chatLog.length === 0 && (
            <p className="py-4 text-center text-xs opacity-45">
              e.g. "Which chapter overlaps the most?" or "How can the student differentiate their study?"
            </p>
          )}
          {chatLog.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'bg-gradient-to-br from-forest-600 to-forest-800 text-white'
                    : 'glass',
                )}
              >
                {m.role === 'user' ? m.content : (
                  <div className="prose-chat"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                )}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex items-center gap-1.5 pl-2">
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
        <form onSubmit={ask} className="glass flex items-center gap-2 rounded-2xl p-1.5">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask the reviewer a follow-up…"
            className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:opacity-45"
          />
          <Button type="submit" size="icon-sm" disabled={!question.trim() || asking} aria-label="Send">
            <Send size={14} />
          </Button>
        </form>
      </GlassCard>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
export default function Novelty() {
  const [activeScan, setActiveScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const queryClient = useQueryClient()

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['scan-history'],
    queryFn: getScanHistory,
  })

  const runScan = async (file) => {
    setScanning(true)
    setActiveScan(null)
    try {
      const result = await scanDuplication(file)
      setActiveScan(result)
      queryClient.invalidateQueries({ queryKey: ['scan-history'] })
      const pct = result.duplication_percentage ?? 0
      if (pct >= 50) {
        toast.warning(`High duplication detected: ${pct.toFixed(1)}%`)
      } else {
        toast.success(`Scan complete — ${pct.toFixed(1)}% duplication`)
      }
    } catch (err) {
      toast.error('Scan failed', { description: apiErrorMessage(err) })
    } finally {
      setScanning(false)
    }
  }

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Novelty <span className="text-gradient-isu">Check</span>
          </h1>
          <p className="mt-1 text-sm opacity-55">
            Validate proposed topics against the archive at the paper-mandated 85% similarity threshold.
          </p>
        </div>
        <div className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium opacity-70">
          <ShieldCheck size={13} className="text-gold-400" />
          Faculty & administrators only
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-5 lg:col-span-2">
          <GlassCard className="p-6">
            <ScanDropzone onScan={runScan} scanning={scanning} />
          </GlassCard>

          <AnimatePresence mode="wait">
            {activeScan && (
              <ScanResult
                key={activeScan.id}
                scan={activeScan}
                onAsk={() => queryClient.invalidateQueries({ queryKey: ['scan-history'] })}
              />
            )}
          </AnimatePresence>
        </div>

        {/* History timeline */}
        <GlassCard className="h-fit p-5">
          <div className="mb-4 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider opacity-50">
            <History size={13} /> Scan history
          </div>
          {loadingHistory ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : history.length === 0 ? (
            <EmptyState icon={FileSearch} title="No scans yet" message="Your novelty scans will appear here." />
          ) : (
            <div className="space-y-2">
              {history.map((scan) => {
                const pct = scan.duplication_percentage ?? 0
                const active = activeScan?.id === scan.id
                return (
                  <button
                    key={scan.id}
                    onClick={() => setActiveScan(scan)}
                    className={cn(
                      'w-full rounded-2xl p-3.5 text-left transition-colors duration-200',
                      active
                        ? 'bg-forest-600/12 dark:bg-forest-400/12'
                        : 'hover:bg-forest-900/6 dark:hover:bg-white/6',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{scan.filename}</span>
                      <span
                        className={cn(
                          'shrink-0 font-display text-sm font-extrabold',
                          pct >= 60 ? 'text-flame-500' : pct >= 30 ? 'text-gold-500 dark:text-gold-300' : 'text-forest-600 dark:text-forest-300',
                        )}
                      >
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1 text-[0.65rem] opacity-45">{timeAgo(scan.created_at)}</div>
                  </button>
                )
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </PageTransition>
  )
}
