import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractOwnedAvatarPath,
  formatDate,
  normalizePercent,
  scanMetrics,
  timeAgo,
  verdictLabel,
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
