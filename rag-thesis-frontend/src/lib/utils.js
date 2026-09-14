import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso) {
  if (!iso) return ''
  try {
    const value = new Date(iso)
    if (Number.isNaN(value.getTime())) return ''
    return value.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function timeAgo(iso) {
  if (!iso) return ''
  const timestamp = new Date(iso).getTime()
  if (Number.isNaN(timestamp)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

/**
 * Render a stored percentage, upgrading a legacy 0-1 ratio.
 *
 * Only safe for values that cannot legitimately fall in (0, 1]: a similarity
 * or threshold is always at or above the retrieval/duplication threshold, so a
 * value of 1 or less is certainly an old ratio. Do NOT use it for matched-chunk
 * coverage, which genuinely can be a fraction of one percent — see scanMetrics.
 */
export function normalizePercent(value) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) return 0
  const percent = number > 0 && number <= 1 ? number * 100 : number
  return Math.min(100, Math.max(0, percent))
}

/**
 * Duplication metrics for one ingestion screening or novelty scan record.
 *
 * Coverage is derived from the chunk counts whenever both are present, because
 * the stored percentage is ambiguous below 1. One matching chunk in a
 * 300-chunk manuscript is 0.33% coverage, which normalizePercent would read as
 * a legacy ratio and report as 33% — contradicting the verdict shown beside it
 * and overstating the overlap by two orders of magnitude, including in the
 * downloadable scan report. The counts carry no such ambiguity. Records too
 * old to carry counts still fall back to the stored percentage.
 */
/**
 * Passages absorbed by the single most-matched thesis, or 0.
 *
 * An ingest-time screening stores `matched_papers`; a query-time novelty scan
 * stores the same shape as `top_matches` and has no `top_paper_percentage`
 * column to write to. Both carry `match_count`, so the concentration the
 * verdict is graded on is recoverable from either, including for scans run
 * before the field existed.
 */
function largestMatchCount(record) {
  const groups = Array.isArray(record.matched_papers) ? record.matched_papers
    : Array.isArray(record.top_matches) ? record.top_matches : []
  return groups.reduce((most, group) => Math.max(most, Number(group?.match_count) || 0), 0)
}

export function scanMetrics(scan = {}) {
  const record = scan && typeof scan === 'object' && !Array.isArray(scan) ? scan : {}
  const matchedChunks = Math.max(0, Number(record.matched_chunk_count ?? 0) || 0)
  const totalChunks = Math.max(0, Number(record.total_chunks ?? 0) || 0)
  const hasChunkCounts = record.matched_chunk_count != null
    && record.total_chunks != null
    && totalChunks > 0
  const largest = largestMatchCount(record)
  return {
    highest: normalizePercent(record.highest_similarity),
    coverage: hasChunkCounts
      ? Math.min(100, (matchedChunks / totalChunks) * 100)
      : normalizePercent(record.matched_chunk_percentage ?? record.duplication_percentage),
    // Share of this thesis whose closest neighbour sits in ONE archived
    // thesis. The verdict keys off this, not coverage: in a one-department
    // archive coverage climbs toward 100% for everyone as the corpus grows,
    // while concentration thins as template matches spread across more papers
    // and only a genuine near-duplicate keeps it high.
    //
    // Derived from the counts for the same reason coverage is: a stored
    // percentage below 1 is indistinguishable from a legacy 0-1 ratio, and one
    // matched passage in 200 is 0.5%. The counts carry no such ambiguity, and
    // deriving also fills in query-time scans, which have no column to store
    // the figure in.
    concentration: hasChunkCounts && largest
      ? Math.min(100, (largest / totalChunks) * 100)
      : normalizePercent(record.top_paper_percentage),
    matchedChunks,
    totalChunks,
    verdict: record.verdict_level || (matchedChunks === 0 ? 'clear' : 'review_suggested'),
  }
}

/**
 * The most recent screening inside a paper's duplication record.
 *
 * Screening runs once, during ingestion, against only the theses indexed
 * before it — so an early upload's card names an early paper and cannot name a
 * closer one that arrived later. `scripts/rescan_duplication.py` re-screens
 * against the whole archive and nests the result under `rescan` rather than
 * overwriting, because the at-upload figures are the only record of what the
 * archive held on the day a thesis was accepted and cannot be recomputed once
 * it has grown. This returns whichever layer is current; `atUploadScreening`
 * returns the historical one.
 */
function screeningRecord(scan) {
  return scan && typeof scan === 'object' && !Array.isArray(scan) ? scan : {}
}

/**
 * True when this record carries a rescan.
 *
 * Callers must ask this rather than comparing `currentScreening` against
 * `atUploadScreening` by identity: the latter always builds a fresh object, so
 * the two are never the same reference and the comparison reads as "rescanned"
 * for every paper.
 */
export function hasRescan(scan) {
  const rescan = screeningRecord(scan).rescan
  return Boolean(rescan) && typeof rescan === 'object' && !Array.isArray(rescan)
}

export function currentScreening(scan) {
  const record = screeningRecord(scan)
  return hasRescan(record) ? record.rescan : record
}

/** The original ingest-time screening, with any nested rescan stripped off. */
export function atUploadScreening(scan) {
  const record = screeningRecord(scan)
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'rescan'))
}

/**
 * How many theses one screening run compared against, as a phrase, or ''.
 *
 * `archive_size` is recorded by the screening itself. `archive_size_estimated`
 * is derived afterwards from upload order by
 * `scripts/backfill_screening_archive_size.py`, for the runs that predate that
 * field, and it can be wrong in three ways the script documents — a thesis
 * deleted since is not counted, one still ingesting is. So it is rendered as
 * an estimate and never silently as the real figure. A recorded size always
 * wins; neither present renders nothing at all rather than a guess of zero.
 */
export function archiveSizeLabel(screening) {
  const record = screening && typeof screening === 'object' ? screening : {}
  const recorded = Number(record.archive_size) || 0
  const estimated = Number(record.archive_size_estimated) || 0
  const count = recorded || estimated
  if (!count) return ''
  const theses = `${count} ${count === 1 ? 'thesis' : 'theses'}`
  return recorded ? `against ${theses}` : `against about ${theses} (estimated)`
}

/**
 * True when either screening layer flagged this thesis.
 *
 * Every surface that decides whether to show a screening must ask this rather
 * than reading `duplication_scan.flagged`, which is the at-upload value only.
 * A thesis uploaded before the ones it resembles is clear at upload and
 * flagged on recheck: reading the top-level field left the archive grid with
 * no badge at all on Performance Appraisal while its own panel read
 * "high overlap, 52.63%".
 */
export function isScreeningFlagged(scan) {
  return Boolean(atUploadScreening(scan).flagged) || Boolean(currentScreening(scan).flagged)
}

/**
 * True when a recheck reproduced the upload exactly.
 *
 * The last thesis indexed already saw the whole archive, so its recheck finds
 * precisely what its upload did. Printing both blocks then repeats four
 * identical figures and reads as though something changed.
 */
export function screeningIsUnchanged(scan) {
  if (!hasRescan(scan)) return false
  const atUpload = scanMetrics(atUploadScreening(scan))
  const current = scanMetrics(currentScreening(scan))
  return atUpload.verdict === current.verdict
    && atUpload.matchedChunks === current.matchedChunks
    && atUpload.totalChunks === current.totalChunks
    && atUpload.highest === current.highest
}

/** True when a rescan exists and reached a different verdict than the upload did. */
export function screeningHasDrifted(scan) {
  const record = screeningRecord(scan)
  if (!hasRescan(record)) return false
  return currentScreening(record).verdict_level !== atUploadScreening(record).verdict_level
}

/**
 * One plain sentence saying what a verdict means, for readers who are not
 * going to interpret a coverage percentage on their own.
 *
 * Deliberately says what the system did and did not conclude. These are cosine
 * similarities over embeddings, not text matching: two theses from one college
 * in one year share a template, a methodology chapter and an institution, and
 * measured over this archive on 2026-09-14 even the closest pair shared under
 * 1% of its wording verbatim. The screen flags topic overlap for a human; it
 * does not make a finding about misconduct, and saying so on the card is the
 * difference between a useful signal and an accusation.
 */
export function verdictExplanation(level) {
  if (level === 'exact_duplicate') {
    return 'Every passage already exists in the archive, so this was not indexed again.'
  }
  if (level === 'high_overlap') {
    return 'Most of this thesis points at one archived thesis in particular. A faculty reviewer should compare the two. This measures topic similarity, not copied wording.'
  }
  if (level === 'review_suggested') {
    return 'A noticeable share of this thesis points at one archived thesis, though most of it does not. Worth a look.'
  }
  return 'No single archived thesis accounts for much of this one. Passages that did match are spread across the archive, which is what a shared template and a shared institution look like.'
}

/**
 * The archived thesis a screening record most resembles, or null.
 *
 * The backend ranks matched papers by absorbed chunk count, then closest
 * passage, and repeats the head of that list as `most_similar_paper`. Records
 * written before 2026-09-08 only carry the list.
 */
export function mostSimilarPaper(scan) {
  const record = scan && typeof scan === 'object' && !Array.isArray(scan) ? scan : {}
  if (record.most_similar_paper && typeof record.most_similar_paper === 'object') return record.most_similar_paper
  const [head] = Array.isArray(record.matched_papers) ? record.matched_papers : []
  return head && typeof head === 'object' ? head : null
}

export function verdictLabel(level) {
  if (level === 'exact_duplicate') return 'Exact duplicate—not indexed'
  if (level === 'high_overlap') return 'High overlap—faculty review required'
  if (level === 'review_suggested') return 'Review suggested'
  return 'Clear'
}

/**
 * The badge tone a screening verdict deserves.
 *
 * The archive card used to paint every flagged paper flame-red, and `flagged`
 * is true when a *single* chunk matched: a thesis at 7.14% coverage (2 chunks
 * of shared institutional boilerplate out of 28) shouted exactly as loudly as
 * one at 96.30%. Theses from one college in one year legitimately share front
 * matter and a methodology chapter, so that reading is common and the uniform
 * red trained people to ignore the badge that matters.
 *
 * The bands are the backend's (services/novelty.py::verdict_for_concentration)
 * and key off concentration, not coverage: under 25% of a thesis pointing at
 * one archived thesis is `clear`, 25-70% is `review_suggested`, 70% and over
 * is `high_overlap`,
 * and `exact_duplicate` is every chunk verbatim — the worker refuses that job,
 * so the level only reaches this UI through a failed job's screening record.
 * Semantic aliases rather than hues, so the audited AA pairings still apply.
 */
export function verdictTone(level) {
  if (level === 'exact_duplicate' || level === 'high_overlap') return 'critical'
  if (level === 'review_suggested') return 'warning'
  return 'neutral'
}

export function extractOwnedAvatarPath(publicUrl, userId) {
  if (!publicUrl || !userId) return null
  if (!publicUrl.includes('://')) {
    return publicUrl.startsWith(`${userId}/`) ? publicUrl : null
  }
  try {
    const pathname = decodeURIComponent(new URL(publicUrl).pathname)
    const marker = '/storage/v1/object/public/avatars/'
    const path = pathname.includes(marker) ? pathname.split(marker)[1] : ''
    return path.startsWith(`${userId}/`) ? path : null
  } catch {
    return null
  }
}
