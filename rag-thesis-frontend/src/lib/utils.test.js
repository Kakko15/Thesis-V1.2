import test from 'node:test'
import assert from 'node:assert/strict'

import {
  archiveSizeLabel,
  atUploadScreening,
  currentScreening,
  extractOwnedAvatarPath,
  formatDate,
  hasRescan,
  isScreeningFlagged,
  normalizePercent,
  mostSimilarPaper,
  scanMetrics,
  screeningHasDrifted,
  screeningIsUnchanged,
  timeAgo,
  verdictExplanation,
  verdictLabel,
  verdictTone,
} from './utils.js'

test('normalizes legacy ratios and clamps invalid percentages', () => {
  assert.equal(normalizePercent(0.85), 85)
  assert.equal(normalizePercent(85), 85)
  assert.equal(normalizePercent(120), 100)
  assert.equal(normalizePercent(-2), 0)
  assert.equal(normalizePercent('not-a-number'), 0)
})

test('builds safe scan metrics from legacy and current records', () => {
  assert.deepEqual(scanMetrics({
    highest_similarity: 0.9,
    duplication_percentage: 25,
    matched_chunk_count: 2,
    total_chunks: 8,
  }), {
    highest: 90,
    coverage: 25,
    matchedChunks: 2,
    totalChunks: 8,
    verdict: 'review_suggested',
  })
  assert.equal(verdictLabel('high_overlap'), 'High overlap—faculty review required')
  assert.equal(verdictLabel('exact_duplicate'), 'Exact duplicate—not indexed')
})

test('names the archived thesis a screening most resembles', () => {
  // The worker sends the top-ranked match twice: as matched_papers[0] and as
  // most_similar_paper. Older records only have the list, so the helper falls
  // back to its head rather than showing nothing.
  const paper = { id: 'p1', title: 'Archived thesis', year: 2025, similarity: 94.94, match_count: 26 }
  assert.deepEqual(mostSimilarPaper({ most_similar_paper: paper, matched_papers: [] }), paper)
  assert.deepEqual(mostSimilarPaper({ matched_papers: [paper, { id: 'p2' }] }), paper)
  assert.equal(mostSimilarPaper({ matched_papers: [] }), null)
  assert.equal(mostSimilarPaper(null), null)
  assert.equal(mostSimilarPaper('legacy-string'), null)
})

test('reports sub-one-percent coverage without rescaling it as a legacy ratio', () => {
  // One matching chunk in a 300-chunk manuscript is 0.33% coverage. Passing the
  // stored percentage through normalizePercent read it as a 0-1 ratio and
  // reported 33.00%, which contradicted the "review suggested" verdict beside
  // it and reached the downloadable scan report.
  assert.equal(scanMetrics({
    matched_chunk_percentage: 0.33,
    matched_chunk_count: 1,
    total_chunks: 300,
    verdict_level: 'review_suggested',
  }).coverage.toFixed(2), '0.33')
  assert.equal(scanMetrics({
    matched_chunk_percentage: 0.67,
    matched_chunk_count: 2,
    total_chunks: 300,
    verdict_level: 'review_suggested',
  }).coverage.toFixed(2), '0.67')
  // Counts stay authoritative for ordinary values too.
  assert.equal(scanMetrics({
    matched_chunk_percentage: 13.33,
    matched_chunk_count: 40,
    total_chunks: 300,
  }).coverage.toFixed(2), '13.33')
  // A record too old to carry counts still falls back to the stored value,
  // legacy ratio upgrade included.
  assert.equal(scanMetrics({ duplication_percentage: 0.42 }).coverage, 42)
  assert.equal(scanMetrics({ duplication_percentage: 42 }).coverage, 42)
  // Corrupt counts cannot exceed 100%.
  assert.equal(scanMetrics({ matched_chunk_count: 9, total_chunks: 4 }).coverage, 100)
})

test('builds empty scan metrics for null and malformed legacy records', () => {
  const expected = {
    highest: 0,
    coverage: 0,
    matchedChunks: 0,
    totalChunks: 0,
    verdict: 'clear',
  }
  assert.deepEqual(scanMetrics(null), expected)
  assert.deepEqual(scanMetrics('legacy-invalid-value'), expected)
  assert.deepEqual(scanMetrics([]), expected)
})

test('date helpers fail closed for invalid values', () => {
  assert.equal(formatDate('not-a-date'), '')
  assert.equal(timeAgo('not-a-date'), '')
})

test('accepts only avatar paths owned by the active user', () => {
  const own = 'https://example.supabase.co/storage/v1/object/public/avatars/u1/avatar.png'
  const other = 'https://example.supabase.co/storage/v1/object/public/avatars/u2/avatar.png'
  assert.equal(extractOwnedAvatarPath(own, 'u1'), 'u1/avatar.png')
  assert.equal(extractOwnedAvatarPath('u1/avatar.png', 'u1'), 'u1/avatar.png')
  assert.equal(extractOwnedAvatarPath(other, 'u1'), null)
  assert.equal(extractOwnedAvatarPath('invalid-url', 'u1'), null)
})

test('a screening verdict picks its own badge tone', () => {
  // The archive card painted every flagged paper flame-red, and `flagged` is
  // true when a single chunk matched. Twelve real CCSICT theses ingested on
  // 2026-09-08 scored anywhere from 7.14% coverage (two chunks of shared
  // institutional front matter) to 96.30%, and all twelve looked equally
  // alarming, so the badge said nothing.
  assert.equal(verdictTone('high_overlap'), 'critical')
  assert.equal(verdictTone('exact_duplicate'), 'critical')
  assert.equal(verdictTone('review_suggested'), 'warning')
  assert.equal(verdictTone('clear'), 'neutral')
  // An unknown or absent verdict must not shout.
  assert.equal(verdictTone(undefined), 'neutral')
  assert.equal(verdictTone('something-new'), 'neutral')

  // Read through scanMetrics the way the card does. Every record the backend
  // writes carries verdict_level, so this is the live path.
  const toneFor = (record) => verdictTone(scanMetrics(record).verdict)
  assert.equal(toneFor({
    matched_chunk_count: 2, total_chunks: 28, verdict_level: 'review_suggested',
  }), 'warning')
  assert.equal(toneFor({
    matched_chunk_count: 26, total_chunks: 27, verdict_level: 'high_overlap',
  }), 'critical')

  // A record predating verdict_level is graded by scanMetrics' own fallback,
  // which reports review_suggested for any non-zero match rather than
  // recomputing the band. It therefore reads gold, never red — the safe
  // direction for a value nobody has scored.
  assert.equal(toneFor({ matched_chunk_count: 0, total_chunks: 28 }), 'neutral')
  assert.equal(toneFor({ matched_chunk_count: 26, total_chunks: 27 }), 'warning')
})

// Screening is a snapshot taken during ingestion, so a card can only name a
// thesis that was already indexed. rescan_duplication.py re-screens against the
// whole archive and nests the result rather than overwriting, because the
// at-upload figures cannot be recomputed once the archive has grown.
const AT_UPLOAD = {
  flagged: true,
  verdict_level: 'review_suggested',
  matched_chunk_count: 3,
  total_chunks: 24,
  archive_size: 9,
}
const RESCAN = {
  flagged: true,
  verdict_level: 'high_overlap',
  matched_chunk_count: 22,
  total_chunks: 24,
  archive_size: 15,
}

test('reads the current screening from a rescanned record', () => {
  const record = { ...AT_UPLOAD, rescan: RESCAN }
  assert.equal(currentScreening(record).verdict_level, 'high_overlap')
  assert.equal(scanMetrics(currentScreening(record)).coverage.toFixed(2), '91.67')
})

test('falls back to the record itself when never rescanned', () => {
  assert.equal(currentScreening(AT_UPLOAD).verdict_level, 'review_suggested')
  assert.equal(currentScreening(null).verdict_level, undefined)
  assert.equal(currentScreening({ rescan: 'not-an-object' }).rescan, 'not-an-object')
})

test('the at-upload layer survives a rescan unchanged', () => {
  const record = { ...AT_UPLOAD, rescan: RESCAN }
  const atUpload = atUploadScreening(record)
  assert.equal(atUpload.verdict_level, 'review_suggested')
  assert.equal(atUpload.archive_size, 9)
  assert.equal(atUpload.rescan, undefined)
  assert.equal(scanMetrics(atUpload).coverage.toFixed(2), '12.50')
})

test('drift is only reported when the verdict actually moved', () => {
  assert.equal(screeningHasDrifted({ ...AT_UPLOAD, rescan: RESCAN }), true)
  assert.equal(screeningHasDrifted({ ...AT_UPLOAD, rescan: { ...AT_UPLOAD } }), false)
  assert.equal(screeningHasDrifted(AT_UPLOAD), false)
  assert.equal(screeningHasDrifted(null), false)
})

test('every verdict has a plain-language explanation that avoids accusing anyone', () => {
  for (const level of ['clear', 'review_suggested', 'high_overlap', 'exact_duplicate']) {
    const sentence = verdictExplanation(level)
    assert.ok(sentence.length > 20, `${level} needs a real sentence`)
    assert.ok(!/plagiar|copied from|stolen|misconduct/i.test(sentence),
      `${level} must not read as an accusation`)
  }
  assert.match(verdictExplanation('high_overlap'), /not copied wording/)
  assert.equal(verdictExplanation('anything-else'), verdictExplanation('clear'))
})

test('rescan presence is a property of the record, not an identity comparison', () => {
  // atUploadScreening always builds a fresh object, so comparing it against
  // currentScreening by reference reports "rescanned" for every paper.
  assert.equal(hasRescan({ ...AT_UPLOAD, rescan: RESCAN }), true)
  assert.equal(hasRescan(AT_UPLOAD), false)
  assert.equal(hasRescan({ ...AT_UPLOAD, rescan: null }), false)
  assert.equal(hasRescan({ ...AT_UPLOAD, rescan: [] }), false)
  assert.equal(hasRescan(null), false)
  assert.notEqual(currentScreening(AT_UPLOAD), atUploadScreening(AT_UPLOAD))
})

test('a paper flagged only on recheck still gets a badge', () => {
  // Performance Appraisal was the first of its cluster indexed, so its upload
  // screening was clear and the archive grid showed no badge at all while its
  // own panel read "high overlap, 52.63%".
  const clearAtUpload = { flagged: false, verdict_level: 'clear', matched_chunk_count: 0, total_chunks: 19 }
  const flaggedNow = { flagged: true, verdict_level: 'high_overlap', matched_chunk_count: 10, total_chunks: 19 }
  assert.equal(isScreeningFlagged({ ...clearAtUpload, rescan: flaggedNow }), true)
  assert.equal(isScreeningFlagged(clearAtUpload), false)
  assert.equal(isScreeningFlagged({ ...AT_UPLOAD, rescan: { ...RESCAN, flagged: false } }), true)
  assert.equal(isScreeningFlagged(null), false)
})

test('an identical recheck is reported as unchanged rather than printed twice', () => {
  // The last thesis indexed already saw the whole archive, so its recheck
  // reproduces its upload exactly.
  const same = { flagged: true, verdict_level: 'high_overlap', highest_similarity: 94.94, matched_chunk_count: 35, total_chunks: 36 }
  assert.equal(screeningIsUnchanged({ ...same, rescan: { ...same } }), true)
  assert.equal(screeningIsUnchanged({ ...same, rescan: { ...same, matched_chunk_count: 30 } }), false)
  assert.equal(screeningIsUnchanged({ ...same, rescan: { ...same, highest_similarity: 90 } }), false)
  assert.equal(screeningIsUnchanged(same), false)
  assert.equal(screeningIsUnchanged(null), false)
})

test('a recorded archive size is stated plainly, a derived one as an estimate', () => {
  assert.equal(archiveSizeLabel({ archive_size: 15 }), 'against 15 theses')
  assert.equal(archiveSizeLabel({ archive_size: 1 }), 'against 1 thesis')
  assert.equal(archiveSizeLabel({ archive_size_estimated: 11 }), 'against about 11 theses (estimated)')
  assert.equal(archiveSizeLabel({ archive_size_estimated: 1 }), 'against about 1 thesis (estimated)')
  // A real figure always wins over a figure derived from upload order.
  assert.equal(archiveSizeLabel({ archive_size: 15, archive_size_estimated: 11 }), 'against 15 theses')
  // The first thesis ever indexed was screened against nothing; say nothing
  // rather than "against about 0 theses".
  assert.equal(archiveSizeLabel({ archive_size_estimated: 0 }), '')
  assert.equal(archiveSizeLabel({}), '')
  assert.equal(archiveSizeLabel(null), '')
})
