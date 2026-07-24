import assert from 'node:assert/strict'
import test from 'node:test'

import { buildNoveltyReport } from './report.js'

test('novelty export contains useful metadata without manuscript excerpts or chat', () => {
  const report = buildNoveltyReport({
    filename: 'Proposal.pdf',
    created_at: '2026-07-25T00:00:00Z',
    department: 'CCSICT',
    threshold: 85,
    highest_similarity: 91.25,
    matched_chunk_percentage: 25,
    matched_chunk_count: 2,
    total_chunks: 8,
    verdict_level: 'review_suggested',
    verdict_summary: 'Faculty review is suggested.',
    top_matches: [{
      title: 'Archived Study', authors: 'Researcher', year: 2025,
      track: 'Data Mining', similarity: 91.25, database_text: 'private archived excerpt',
    }],
    matched_chunks: [{ uploaded_text: 'private upload', database_text: 'private archive' }],
    chat_log: [{ content: 'private reviewer exchange' }],
  }, '2026-07-25T01:00:00Z')

  const serialized = JSON.stringify(report)
  assert.equal(report.scope, 'metadata-only novelty advisory')
  assert.equal(report.advisory.highest_passage_similarity_percent, 91.25)
  assert.equal(report.matched_studies[0].title, 'Archived Study')
  assert.doesNotMatch(serialized, /private upload|private archive|private reviewer exchange/)
})

test('novelty export fails closed for malformed optional values', () => {
  const report = buildNoveltyReport(null, '2026-07-25T01:00:00Z')
  assert.equal(report.source.filename, 'Unnamed submission')
  assert.deepEqual(report.matched_studies, [])
  assert.equal(report.advisory.matched_chunks, 0)
})
