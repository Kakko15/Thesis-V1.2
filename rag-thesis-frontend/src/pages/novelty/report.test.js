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

test('a capsule export names its sections and still carries no text', () => {
  const report = buildNoveltyReport({
    filename: 'A Smart Intruder Detection System',
    total_chunks: 4,
    matched_chunk_count: 1,
    capsule_sections: [
      { key: 'title', label: 'Working title', similarity: 92, flagged: true, basis: 'wording',
        closest: { id: 'p1', title: 'SECURE: A Smart Intruder Detection System', year: 2024 } },
      { key: 'methodology', label: 'Methodology', similarity: 0, flagged: false, basis: 'meaning', closest: null },
    ],
  })
  assert.equal(report.source.kind, 'capsule proposal')
  assert.deepEqual(report.capsule_sections, [
    { section: 'Working title', similarity_percent: 92, flagged: true, compared_by: 'title wording',
      closest_thesis: { title: 'SECURE: A Smart Intruder Detection System', year: 2024 } },
    { section: 'Methodology', similarity_percent: 0, flagged: false, compared_by: 'meaning', closest_thesis: null },
  ])
  assert.equal(buildNoveltyReport({ filename: 'draft.pdf' }).source.kind, 'manuscript')
  assert.equal('capsule_sections' in buildNoveltyReport({ filename: 'draft.pdf' }), false)
})
