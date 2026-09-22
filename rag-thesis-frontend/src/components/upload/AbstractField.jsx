import { useId, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookText, ChevronDown, Eraser } from 'lucide-react'
import { AutofillChip } from './AutofillChip'
import { Textarea } from '../ui/Input'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { ABSTRACT_MAX_CHARS, abstractStats } from '../../pages/upload/abstractStats'

const { duration, easing } = motionTokens

// Grows with the abstract instead of showing four lines of it through a
// scrollbar, which is how the panel used to read: a 1,400-character abstract
// arrived as a column of half-sentences behind a scroll thumb, and the
// uploader had to drag a textarea to check a value they had not typed. Past
// this height it scrolls, so the wizard's own actions stay above the fold.
const MIN_SURFACE_PX = 148
const MAX_SURFACE_PX = 384
// An empty field does not need the floor a paragraph does: at 148px it opened
// as a pane of dead space under one line of placeholder.
const EMPTY_SURFACE_PX = 104

/** What the panel says about the abstract it is holding, per measured tone. */
const NOTES = Object.freeze({
  empty: 'Paste or type it — the abstract is indexed for semantic search.',
  brief: 'Shorter than usual. Most abstracts run 150-350 words.',
  ideal: 'Indexed for semantic search and researcher discovery.',
  long: 'Longer than usual. Trim to the core contribution if you can.',
  limit: `Approaching the ${ABSTRACT_MAX_CHARS.toLocaleString()}-character limit.`,
})

const DOT_TONES = Object.freeze({
  empty: 'bg-forest-900/20 dark:bg-white/20',
  brief: 'bg-gold-500/70',
  ideal: 'bg-forest-500',
  long: 'bg-gold-500/70',
  limit: 'bg-flame-500',
})

/**
 * Step 2's abstract: a collapsible reading surface rather than a form control.
 *
 * It used to be a bordered disclosure nested inside a bordered "Description"
 * section — two cards, two icons and two labels for one optional field, with
 * the value itself given the smallest box on the page. This is one card that
 * is a peer of Identity and Classification: the section heading *is* the
 * disclosure trigger, and what is left inside is the prose and what can be
 * said about it.
 *
 * Collapsed until it has something to show. Expanded on an empty form it
 * pushed the wizard's actions below the fold on a laptop, but an autofilled
 * abstract that stays hidden behind a chevron is a value nobody checked —
 * which is the whole point of extracting it. Reading `value` once at mount is
 * enough: this step renders only after extraction has settled, because the
 * manuscript step's Continue button stays disabled while `parsing` is true.
 */
export function AbstractField({ value = '', onChange, onClear, autofilled, variants }) {
  const [open, setOpen] = useState(Boolean(value))
  const surfaceRef = useRef(null)
  const id = useId()
  const headingId = `${id}-heading`
  const panelId = `${id}-panel`
  const noteId = `${id}-note`

  const { chars, words, ratio, tone } = abstractStats(value)
  const filled = words > 0

  // Match the surface to the prose on every edit, and on the first paint after
  // the panel opens — a textarea measures its own scrollHeight as zero while
  // it is inside a collapsed parent.
  useLayoutEffect(() => {
    const node = surfaceRef.current
    if (!node || !open) return
    const floor = value ? MIN_SURFACE_PX : EMPTY_SURFACE_PX
    node.style.height = 'auto'
    node.style.height = `${Math.max(floor, Math.min(node.scrollHeight, MAX_SURFACE_PX))}px`
  }, [value, open])

  return (
    <motion.section
      variants={variants}
      aria-labelledby={headingId}
      className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/70 shadow-xs backdrop-blur-xs transition-shadow hover:shadow-md"
    >
      {/* Decorative glows, as on the security panel: warmth without a border. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-gold-400/10 blur-3xl dark:bg-gold-400/[0.07]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-forest-500/10 blur-3xl dark:bg-forest-400/[0.07]" />

      <h2 id={headingId} className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={panelId}
          className="group flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left outline-none transition-colors duration-200 focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]"
        >
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300',
              filled
                ? 'bg-gradient-to-br from-forest-600 to-forest-800 text-gold-300 shadow-md shadow-forest-900/25 ring-1 ring-white/20'
                : 'bg-gradient-to-br from-forest-600/15 to-forest-800/10 text-forest-700 ring-1 ring-forest-500/20 dark:bg-gold-400/15 dark:text-gold-300',
            )}
          >
            <BookText size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-sm font-bold tracking-tight text-ink">Abstract</span>
              <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                optional
              </span>
              <AutofillChip show={Boolean(autofilled)} />
            </span>
            <span className="mt-1 block truncate text-xs text-ink-muted">
              {filled
                ? `${words.toLocaleString()} words · ${chars.toLocaleString()} characters`
                : 'Adds retrieval context beyond the title and authors.'}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-ink-faint transition-transform duration-300 group-hover:text-ink-muted',
              open && 'rotate-180',
            )}
          />
        </button>
      </h2>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.medium, ease: easing.standard }}
            className="relative overflow-hidden"
          >
            <div className="px-5 pb-5">
              <div
                className={cn(
                  'relative overflow-hidden rounded-2xl border bg-[var(--surface-0)]',
                  'transition-[border-color,box-shadow] duration-300',
                  'focus-within:border-[var(--primary)] focus-within:shadow-[inset_0_0_0_1px_var(--primary)]',
                  filled ? 'border-[var(--border)]' : 'border-dashed border-[var(--input)]',
                )}
              >
                <Textarea
                  ref={surfaceRef}
                  value={value}
                  onChange={onChange}
                  // Hard-capped at the server's own ceiling: a 422 on submit
                  // after a long paste is a worse answer than a paste that
                  // stops, and the meter below says where the edge is.
                  maxLength={ABSTRACT_MAX_CHARS}
                  placeholder="Paste the thesis abstract…"
                  aria-label="Thesis abstract"
                  aria-describedby={noteId}
                  className={cn(
                    // The height itself is owned by the layout effect above;
                    // this is only the floor it starts from on first paint.
                    'min-h-[104px] resize-none border-0 bg-transparent px-5 py-4',
                    'text-[15px] font-normal leading-[1.75] tracking-[0.01em]',
                    'hover:border-0 focus:border-0 focus:shadow-none',
                  )}
                />
                {/* One pass of light over text the uploader did not type, so
                    the autofill is something they watch happen rather than
                    something they find. It animates on mount and parks off the
                    right edge; no state, because a setState in an effect is a
                    cascading render (and the lint rule that says so is right).
                    Reduced motion is handled by the app's MotionConfig. */}
                {autofilled && filled && (
                  <motion.span
                    aria-hidden="true"
                    initial={{ x: '-130%' }}
                    animate={{ x: '130%' }}
                    transition={{ duration: duration.long, ease: easing.standard }}
                    className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-gold-300/25 to-transparent"
                  />
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p id={noteId} className="flex min-w-0 items-center gap-2 text-[11px] text-ink-faint">
                  <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_TONES[tone])} />
                  {NOTES[tone]}
                </p>
                {/* The meter earns its place only near the ceiling. Below that
                    it sat at a permanent few percent and read as a target. */}
                {ratio > 0.6 && (
                  <span className="flex items-center gap-2 text-[11px] font-mono text-ink-faint">
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-forest-900/10 dark:bg-white/10">
                      <motion.span
                        className={cn('block h-full rounded-full', tone === 'limit' ? 'bg-flame-500' : 'bg-forest-500')}
                        initial={false}
                        animate={{ width: `${Math.round(ratio * 100)}%` }}
                        transition={{ duration: duration.short, ease: easing.standard }}
                      />
                    </span>
                    {chars.toLocaleString()} / {ABSTRACT_MAX_CHARS.toLocaleString()}
                  </span>
                )}
                {filled && (
                  <button
                    type="button"
                    onClick={onClear}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-muted outline-none transition-colors hover:bg-forest-900/6 hover:text-ink focus-visible:shadow-[inset_0_0_0_2px_var(--ring)] dark:hover:bg-white/8"
                  >
                    <Eraser size={12} aria-hidden="true" /> Clear
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
