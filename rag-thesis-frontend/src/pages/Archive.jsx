import { motion, AnimatePresence } from 'framer-motion'
import { BookMarked, Trash2, Library, Lock, X, ShieldAlert, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { GlassCard } from '../components/ui/GlassCard'
import { Badge } from '../components/ui/Badge'
import { Skeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { ConfirmDialog, Modal } from '../components/ui/Modal'
import { PageTransition } from '../components/ui/Motion'
import { usePreferences } from '../context/PreferencesContext'
import { Button } from '../components/ui/Button'
import { GooglePagination } from '../components/ui/Pagination'
import {
  archiveSizeLabel, atUploadScreening, cn, currentScreening, formatDate, hasRescan,
  isScreeningFlagged, normalizePercent, scanMetrics, screeningIsUnchanged,
  verdictExplanation, verdictLabel, verdictTone,
} from '../lib/utils'
import { isFacultyThesis, thesisCategoryLabel } from '../lib/catalog'
import { slotKeys } from '../lib/keys'
import { useArchiveCatalog } from './archive/useArchiveCatalog'
import { ArchiveFiltersBar } from './archive/ArchiveFiltersBar'

const ARCHIVE_SKELETONS = slotKeys(6, 'archive-card')

// Paging moves the whole result set sideways, like a filmstrip: the outgoing
// page and the incoming one travel together at the same speed, one leaving as
// the other arrives. Nothing fades -- a cross-fade makes two pages occupy the
// same space at half opacity each, which reads as a flicker rather than as
// movement and tells the reader nothing about which way they just went.
//
// `x` is a percentage of the grid's own width, so the two pages abut exactly
// and the strip stays continuous at any viewport size.
const SLIDE = {
  enter: (direction) => ({ x: direction >= 0 ? '100%' : '-100%' }),
  center: { x: '0%' },
  exit: (direction) => ({ x: direction >= 0 ? '-100%' : '100%' }),
}
// Near-critically damped: it leaves immediately on the press and settles
// without overshooting, so the page never rocks back into place.
const SLIDE_SPRING = { type: 'spring', stiffness: 340, damping: 38, mass: 0.9 }


// The panel behind the card badge, keyed off the same verdict so the two
// cannot disagree — a gold badge opening onto a red panel would just move the
// confusion one click deeper.
const SCREENING_SURFACE = {
  critical: 'border-flame-500/25 bg-flame-500/8',
  warning: 'border-gold-400/30 bg-gold-400/8',
  neutral: 'border-[var(--border)] bg-[var(--surface-2)]',
}
const SCREENING_ICON = {
  critical: 'text-flame-500',
  warning: 'text-gold-500',
  neutral: 'text-ink-faint',
}

// The bands the backend grades on (services/novelty.py::
// verdict_for_concentration), drawn rather than described. A reader who can
// see where 81% falls between the 25 and 70 marks has the verdict before they
// have read a word of it, which is what the figure grid this replaced could
// not do: ten numbers at one weight, none of them saying which one decided.
const REVIEW_MARK = 25
const HIGH_OVERLAP_MARK = 70

const METER_FILL = {
  critical: 'bg-flame-500',
  warning: 'bg-gold-400',
  neutral: 'bg-forest-500',
}
const METER_TEXT = {
  critical: 'text-flame-500',
  warning: 'text-gold-500',
  neutral: 'text-forest-700 dark:text-forest-300',
}

/**
 * Concentration on a banded track: the graded figure, and why it graded so.
 *
 * Concentration and not coverage, for the reason `scanMetrics` gives at
 * length: coverage saturates toward 100% for every thesis as a one-department
 * archive grows, so a bar of it would sit full for everyone and mean nothing.
 */
function ConcentrationMeter({ value, tone, caption }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn('font-display text-3xl font-extrabold leading-none tabular-nums', METER_TEXT[tone])}>
          {pct.toFixed(1)}%
        </span>
        <span className="text-ink-muted">of this thesis points at one archived thesis</span>
      </div>
      {/* aria-hidden throughout: the track restates the number above it and the
          band labels restate the verdict beside it, so announcing either again
          is noise to a reader who has already heard both. */}
      <div className="relative mt-2.5 h-2 rounded-full bg-[var(--border)]" aria-hidden="true">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', METER_FILL[tone])}
          style={{ width: `${pct}%` }}
        />
        {[REVIEW_MARK, HIGH_OVERLAP_MARK].map((mark) => (
          <div
            key={mark}
            className="absolute inset-y-0 w-0.5 bg-white/80 dark:bg-black/50"
            style={{ left: `${mark}%` }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-3.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint" aria-hidden="true">
        <span className="absolute left-0">Clear</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${REVIEW_MARK}%` }}>{REVIEW_MARK}%</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${HIGH_OVERLAP_MARK}%` }}>{HIGH_OVERLAP_MARK}%</span>
        <span className="absolute right-0">High overlap</span>
      </div>
      {caption && <div className="mt-1.5 text-ink-faint">{caption}</div>}
    </div>
  )
}

/**
 * The archived theses a screening matched, ranked, each as a share of this
 * thesis's passages.
 *
 * The share is the meter's quantity per paper: "22 of 27 passages" is what
 * makes a total legible, and a row of bars shows at a glance whether one
 * thesis accounts for the verdict or several split it. Only the leader is
 * painted in the verdict's colour, because colouring all of them would say
 * every match is as serious as the one that set the grade.
 */
function MatchedTheses({ papers, totalChunks, tone }) {
  if (!papers.length) return null
  return (
    <ul className="mt-3 space-y-1.5">
      {papers.map((paper, index) => {
        const matched = Number(paper.match_count) || 0
        const share = totalChunks ? Math.min(100, (matched / totalChunks) * 100) : 0
        return (
          <li
            key={paper.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/60 px-2.5 py-2"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-semibold">
                  {paper.title || 'Untitled thesis'}{paper.year ? ` (${paper.year})` : ''}
                </div>
                <div className="mt-0.5 text-ink-muted">
                  {matched ? `${matched} of ${totalChunks} passages · ` : ''}
                  closest passage {normalizePercent(paper.similarity).toFixed(2)}%
                </div>
              </div>
              {share > 0 && (
                <span className="shrink-0 font-display text-sm font-extrabold tabular-nums">
                  {share.toFixed(0)}%
                </span>
              )}
            </div>
            {share > 0 && (
              <div className="mt-1.5 h-1 rounded-full bg-[var(--border)]" aria-hidden="true">
                <div
                  className={cn('h-1 rounded-full', index === 0 ? METER_FILL[tone] : 'bg-ink-faint/40')}
                  style={{ width: `${share}%` }}
                />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The supporting figures, deliberately below the meter and all at one weight.
 *
 * These are the numbers a reviewer asks for second. Coverage stays, because it
 * is what the earlier records and the paper's tables report, but it is
 * labelled for what it is: on its own it reads as an accusation, since a
 * thesis can match something everywhere and still have no single archived
 * thesis accounting for a tenth of it.
 */
function ScreeningFigures({ metrics, threshold }) {
  const figures = [
    ['Closest passage', `${metrics.highest.toFixed(2)}%`],
    ['Matched anywhere', `${metrics.coverage.toFixed(2)}%`],
    ['Matched passages', `${metrics.matchedChunks} / ${metrics.totalChunks}`],
    ['Match threshold', `${normalizePercent(threshold).toFixed(2)}%`],
  ]
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--border)] pt-2.5 sm:grid-cols-4">
      {figures.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
          <dd className="font-semibold tabular-nums text-ink-muted">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One dated screening: what a screen saw, and when.
 *
 * The archive it ran against is the part readers cannot infer. A thesis
 * screened when the archive held two others is not comparable to one screened
 * against fifteen, and without the count a stale verdict reads as a current
 * one. `archive_size` is absent on records written before 2026-09-14, so the
 * count is dropped rather than guessed.
 */
function ScreeningRun({ screening, when, tone }) {
  const metrics = scanMetrics(screening)
  const against = archiveSizeLabel(screening)
  const caption = [when ? formatDate(when) : '', against].filter(Boolean).join(' · ')
  if (metrics.matchedChunks === 0) {
    /* A run that matched nothing has no figures worth four cells of zeros.
       This is the normal shape of an early upload's record: the archive it was
       screened against did not yet hold anything it resembles. */
    return (
      <div className="mt-2 text-ink-muted">
        No passage reached the {normalizePercent(screening.threshold).toFixed(2)}% threshold
        {metrics.totalChunks ? ` across all ${metrics.totalChunks} passages.` : '.'}
        {caption ? ` (${caption})` : ''}
      </div>
    )
  }
  return (
    <>
      <ConcentrationMeter value={metrics.concentration} tone={tone} caption={caption} />
      <MatchedTheses
        papers={screening.matched_papers || []}
        totalChunks={metrics.totalChunks}
        tone={tone}
      />
      <ScreeningFigures metrics={metrics} threshold={screening.threshold} />
    </>
  )
}

function ScreeningDetail({ scan, indexedAt }) {
  const atUpload = atUploadScreening(scan)
  const current = currentScreening(scan)
  const rescanned = hasRescan(scan)
  const unchanged = screeningIsUnchanged(scan)
  // A rescan can find overlap where the upload found none, so the panel has to
  // open on either being flagged rather than on the at-upload record alone.
  if (!isScreeningFlagged(scan)) return null
  const metrics = scanMetrics(current)
  const tone = verdictTone(metrics.verdict)
  // The at-upload run is history, not a second verdict, and printing both at
  // full weight was the panel's other readability problem: two near-identical
  // blocks of figures with nothing saying which one is current. It collapses.
  const showHistory = rescanned && !unchanged
  const uploadDate = atUpload.screened_at || indexedAt
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">
        Duplication screening
      </div>
      <div className={cn(
        'mt-1.5 rounded-xl border px-4 py-3.5 text-xs leading-relaxed',
        SCREENING_SURFACE[tone] ?? SCREENING_SURFACE.neutral,
      )}>
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldAlert size={14} className={cn('shrink-0', SCREENING_ICON[tone] ?? SCREENING_ICON.neutral)} />
          {verdictLabel(metrics.verdict)}
        </div>
        <p className="mt-1.5 text-ink-muted">{verdictExplanation(metrics.verdict)}</p>
        <ScreeningRun
          screening={current}
          when={current.screened_at || (rescanned ? null : indexedAt)}
          tone={tone}
        />
        {showHistory && (
          <details className="group mt-3 border-t border-[var(--border)] pt-2.5">
            <summary className="cursor-pointer list-none font-semibold text-ink-muted marker:content-none hover:text-ink">
              <span className="inline-block transition-transform group-open:rotate-90">&#9656;</span>{' '}
              What the screening saw at upload{uploadDate ? ` · ${formatDate(uploadDate)}` : ''}
            </summary>
            <p className="mt-1.5 text-ink-faint">
              Screening runs once when a thesis is uploaded, so it only sees what was already in
              the archive. The recheck above compares against everything indexed since.
            </p>
            <ScreeningRun
              screening={atUpload}
              when={uploadDate}
              tone={verdictTone(scanMetrics(atUpload).verdict)}
            />
          </details>
        )}
        {rescanned && unchanged && (
          <p className="mt-3 border-t border-[var(--border)] pt-2.5 text-ink-faint">
            Unchanged since this thesis was uploaded on {formatDate(uploadDate)} — it was indexed
            late enough to have already seen the whole archive.
          </p>
        )}
      </div>
    </div>
  )
}

function PaperCard({ paper, isAdmin, onDelete, onOpen }) {
  // The badge must agree with the panel, so both read the current screening.
  const screening = scanMetrics(currentScreening(paper.duplication_scan))
  return (
    <>
      {/* R9: this card used to be role="button" with tabIndex={0} while
          containing a real delete <button>. Assistive technology announced a
          button nested inside a button, and the inner control was hard to reach
          predictably. The card is now a plain surface; the title button below is
          the keyboard and AT path, and the delete button is its sibling rather
          than its descendant. The onClick here survives only as a mouse
          convenience for the wider hit area — it exposes no role, so nothing is
          announced twice. */}
      <GlassCard
        hover
        className="group flex h-full cursor-pointer flex-col p-5 active:scale-[0.98] transition-all duration-200 touch-manipulation"
        onClick={() => onOpen(paper)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-md">
            <BookMarked size={16} className="text-gold-300" />
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(paper) }}
              aria-label={`Delete ${paper.title}`}
              className="rounded-lg p-1.5 text-flame-500 opacity-0 transition-opacity hover:bg-flame-500/10 group-hover:opacity-70 hover:!opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame-500"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
        {/* h2: the card titles are the first headings under the page h1. */}
        <h2 className="font-display mt-3.5 text-sm font-bold leading-snug">
          {/* The visible title is contained in the accessible name, so the
              longer label satisfies WCAG 2.5.3 Label in Name. */}
          <button
            type="button"
            aria-label={`View metadata for ${paper.title}`}
            onClick={(event) => { event.stopPropagation(); onOpen(paper) }}
            className="line-clamp-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            {paper.title}
          </button>
        </h2>
        <p className="mt-1.5 line-clamp-1 text-xs text-ink-muted">
          {paper.authors || 'Unknown authors'}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
          {isFacultyThesis(paper) && <Badge tone="gold">Faculty Research</Badge>}
          {paper.track && <Badge tone="forest">{paper.track}</Badge>}
          {paper.year && <Badge tone="neutral">{paper.year}</Badge>}
          {paper.department && <Badge tone="neutral">{paper.department}</Badge>}
          {isScreeningFlagged(paper.duplication_scan) && (
            /* Concentration, not coverage, because the badge's tone already
               comes from `verdictTone` and the verdict is graded on
               concentration: showing coverage next to it let a card read
               "100.00%" in the colour of a clear result, or a low number in
               the colour of a high-overlap one. Coverage falls back in only
               when a stored record has no chunk counts to derive
               concentration from (see scanMetrics), where it is the only
               figure there is. */
            <Badge
              tone={verdictTone(screening.verdict)}
              title={
                `${screening.matchedChunks} of ${screening.totalChunks} passages matched an `
                + `archived thesis at or above the screening threshold — ${verdictLabel(screening.verdict).toLowerCase()}`
              }
            >
              <ShieldAlert size={11} />{' '}
              {screening.concentration > 0
                ? `${screening.concentration.toFixed(2)}% closest thesis`
                : `${screening.coverage.toFixed(2)}% matched coverage`}
            </Badge>
          )}
        </div>
      </GlassCard>
    </>
  )
}

function ArchiveResults({
  isLoading,
  isError,
  filtered,
  paginated,
  papers,
  page,
  direction,
  isAdmin,
  onDelete,
  onOpen,
  onClear,
  onRetry,
}) {
  const { reducedMotion } = usePreferences()
  if (isLoading) {
    return (
      <div className="grid min-h-[380px] content-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ARCHIVE_SKELETONS.map((slotId) => <Skeleton key={slotId} className="h-44" />)}
      </div>
    )
  }
  if (isError) {
    return (
      <GlassCard>
        <EmptyState
          icon={AlertTriangle}
          title="Archive unavailable"
          message="The archive could not be loaded. Check the backend and database configuration, then try again."
          action={<Button variant="secondary" size="sm" onClick={onRetry}>Retry archive</Button>}
        />
      </GlassCard>
    )
  }
  if (filtered.length === 0) {
    const hasPapers = Boolean(papers?.length)
    return (
      <GlassCard>
        <EmptyState
          icon={Library}
          title={hasPapers ? 'No matches found' : 'The archive is empty'}
          message={hasPapers
            ? 'Try different keywords or clear the filters.'
            : 'Indexed theses will appear here once an administrator uploads them.'}
          action={hasPapers ? (
            <Button variant="secondary" size="sm" onClick={onClear}>
              <X size={14} /> Clear filters
            </Button>
          ) : null}
        />
      </GlassCard>
    )
  }
  const displayPapers = paginated || filtered
  const cards = displayPapers.map((paper) => (
    <PaperCard
      key={paper.id}
      paper={paper}
      isAdmin={isAdmin}
      onDelete={onDelete}
      onOpen={onOpen}
    />
  ))
  const grid = 'grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-3'
  if (reducedMotion) {
    return <div className={cn(grid, 'min-h-[380px]')}>{cards}</div>
  }
  return (
    // The window the strip runs through: horizontal overflow is clipped so
    // incoming and outgoing pages don't bleed into the gutters during the slide.
    // `overflow-x-clip` avoids creating an artificial backdrop root (unlike
    // `clip-path`), eliminating tinted backdrop rectangles and cut-off shadow lines
    // while keeping vertical hover lift unclipped.
    <div className="relative min-h-[380px] overflow-x-clip">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={page}
          custom={direction}
          variants={SLIDE}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SLIDE_SPRING}
          className={grid}
        >
          {cards}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function ArchiveDetailModal({ detail, onClose }) {
  return (
    <Modal open={Boolean(detail)} onClose={onClose} title={detail?.title} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={isFacultyThesis(detail) ? 'gold' : 'forest'}>
            {thesisCategoryLabel(detail?.thesis_category)}
          </Badge>
          {detail?.track && <Badge tone="forest">{detail.track}</Badge>}
          {detail?.department && <Badge tone="neutral">{detail.department}</Badge>}
          {detail?.year && <Badge tone="gold">{detail.year}</Badge>}
          <Badge tone="neutral">Indexed {formatDate(detail?.created_at)}</Badge>
        </div>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">Authors</div>
          <p className="mt-1 text-sm">{detail?.authors || 'Unknown'}</p>
        </div>
        {detail?.abstract && (
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-ink-faint">Abstract</div>
            <p className="mt-1 max-h-56 overflow-y-auto text-sm leading-relaxed opacity-80">
              {detail.abstract}
            </p>
          </div>
        )}
        <ScreeningDetail scan={detail?.duplication_scan} indexedAt={detail?.created_at} />
        <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs text-ink-muted">
          <Lock size={13} className="shrink-0 text-gold-400" />
          Full text is available only through AI-mediated synthesis in Chat — this protects the
          author's intellectual property.
        </div>
      </div>
    </Modal>
  )
}

export default function Archive() {
  const { isAdmin, isSuperadmin, department: userDepartment } = useAuth()
  const archive = useArchiveCatalog({ isSuperadmin, userDepartment })
  const {
    papers, isLoading, isError: papersError, departments, years, filtered,
    filters, setFilter, clearFilters, activeTracks, trackLabel,
    programs, specializations, refetch,
    deleteTarget, setDeleteTarget, detail, setDetail, busy, submitDelete,
    page, pageDirection, setPage, paginated, pageSize,
    sortBy, setSortBy, sortOptions,
  } = archive
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <PageTransition className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-6xl flex-col space-y-6 md:min-h-[calc(100vh-3.5rem)]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Thesis <span className="text-gradient-isu">Archive</span>
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Metadata catalog of every indexed thesis.
          </p>
        </div>
        <div className="glass flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-ink-muted">
          <Lock size={12} className="text-gold-400" />
          Indirect access — full manuscripts are never exposed
        </div>
      </div>

      {/* Google-Style Search, Filter Chips & Sorting Bar */}
      <ArchiveFiltersBar
        filters={filters}
        setFilter={setFilter}
        clearFilters={clearFilters}
        programs={programs}
        specializations={specializations}
        activeTracks={activeTracks}
        trackLabel={trackLabel}
        departments={departments}
        years={years}
        isSuperadmin={isSuperadmin}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOptions={sortOptions}
      />

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p className="text-xs font-medium text-ink-muted">
          Showing {filtered.length} of {papers.length} indexed {papers.length === 1 ? 'thesis' : 'theses'}
        </p>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}><X size={14} /> Clear active filters</Button>
        )}
      </div>

      {/* Results and Pagination container: statically anchored */}
      <div className="flex flex-1 flex-col justify-between gap-6">
        <ArchiveResults
          isLoading={isLoading}
          isError={papersError}
          filtered={filtered}
          paginated={paginated}
          papers={papers}
          page={page}
          direction={pageDirection}
          isAdmin={isAdmin}
          onDelete={setDeleteTarget}
          onOpen={setDetail}
          onClear={clearFilters}
          onRetry={() => refetch()}
        />

        {/* Pagination matching DailyUI Challenge #085 */}
        {!isLoading && !papersError && filtered.length > 0 && (
          // Pinned to the bottom of the viewport rather than left at the end
          // of the results: a full page of cards is taller than the fold, so
          // the control sat off-screen and every page change meant scrolling
          // down to reach the next button and back up to read. Sticky keeps it
          // in reach and in one place without reserving empty rows above it.
          // It clears the mobile tab bar (fixed at bottom-3, z-40) and sits
          // below it in the stack so the two can never fight for the same
          // pixels; `-mx-*` lets its background span the gutters the cards
          // scroll through.
          <div className="sticky bottom-28 z-20 mt-auto -mx-3.5 flex justify-center border-t border-forest-900/10 bg-[var(--surface-0)]/80 px-3.5 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6 md:bottom-8 dark:border-white/10">
            <GooglePagination
              page={page}
              setPage={setPage}
              total={filtered.length}
              limit={pageSize}
              showJump={true}
              hideOnSinglePage={false}
            />
          </div>
        )}
      </div>

      {/* Detail modal — metadata only (indirect access model) */}
      <ArchiveDetailModal detail={detail} onClose={() => setDetail(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={submitDelete}
        title="Remove thesis from the archive?"
        message={`"${deleteTarget?.title}" and all of its vector embeddings will be permanently deleted.`}
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </PageTransition>
  )
}
