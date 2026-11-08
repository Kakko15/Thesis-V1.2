import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNoveltyReport,
  buildNoveltyDocxBytes,
  DEFAULT_DEAN_NAME,
  DEFAULT_DEAN_TITLE,
} from './report.js'

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

test('buildNoveltyDocxBytes produces a valid .docx archive with official template and Dean signature block', () => {
  const scan = {
    filename: 'Smart_Campus_IoT.pdf',
    created_at: '2026-09-24T08:30:00Z',
    department: 'CCSICT',
    threshold: 85,
    highest_similarity: 88.4,
    matched_chunk_percentage: 20,
    matched_chunk_count: 2,
    total_chunks: 10,
    verdict_level: 'review_suggested',
    verdict_summary: 'Moderate overlap detected in the methodology section.',
    top_matches: [{
      title: 'IoT Energy Monitoring for Campus Buildings',
      authors: 'Dela Cruz, J., Santos, M.',
      year: 2024,
      track: 'BSIT',
      similarity: 88.4,
      database_text: 'secret archived passage',
    }],
    matched_chunks: [{ uploaded_text: 'secret uploaded passage', database_text: 'secret archived passage' }],
    chat_log: [{ content: 'secret reviewer chat' }],
  }

  const bytes = buildNoveltyDocxBytes(scan, {
    generatedAt: '2026-09-24T09:00:00Z',
    adviserName: 'Joe G. Lagarteja, DIT',
  })

  assert.equal(bytes instanceof Uint8Array, true)
  // ZIP magic bytes: PK\x03\x04
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  assert.equal(bytes[2], 0x03)
  assert.equal(bytes[3], 0x04)

  const archiveText = new TextDecoder().decode(bytes)
  assert.match(archiveText, /\[Content_Types\]\.xml/)
  assert.match(archiveText, /word\/document\.xml/)
  assert.match(archiveText, /ISABELA STATE UNIVERSITY/)
  assert.match(archiveText, /NOVELTY &amp; SIMILARITY SCREENING REPORT/)
  assert.match(archiveText, /Smart_Campus_IoT\.pdf/)
  assert.match(archiveText, /IoT Energy Monitoring for Campus Buildings/)
  assert.match(archiveText, /Joe G\. Lagarteja, DIT/)
  assert.match(archiveText, new RegExp(DEFAULT_DEAN_NAME))
  assert.match(archiveText, new RegExp(DEFAULT_DEAN_TITLE))
  assert.doesNotMatch(archiveText, /secret uploaded passage|secret archived passage|secret reviewer chat/)
})

test('buildNoveltyDocxBytes renders capsule section table and custom Dean signatory when provided', () => {
  const capsuleScan = {
    filename: 'Capsule_Proposal',
    total_chunks: 4,
    matched_chunk_count: 1,
    capsule_sections: [
      {
        key: 'title',
        label: 'Working title',
        similarity: 92,
        flagged: true,
        basis: 'wording',
        closest: { id: 'p1', title: 'SECURE: A Smart Intruder Detection System', year: 2024 },
      },
      {
        key: 'methodology',
        label: 'Methodology',
        similarity: 0,
        flagged: false,
        basis: 'meaning',
        closest: null,
      },
    ],
  }

  const bytes = buildNoveltyDocxBytes(capsuleScan, {
    adviserName: 'Albert A. Vinluan, DIT',
    deanName: 'CHRISTINE CHARMAINE G. SAN JOSE, DIT',
    deanTitle: 'Dean, CCSICT',
  })
  const archiveText = new TextDecoder().decode(bytes)
  assert.match(archiveText, /Capsule Concept Proposal/)
  assert.match(archiveText, /II\. PER-SECTION ARCHIVE COMPARISON/)
  assert.match(archiveText, /SECURE: A Smart Intruder Detection System \(2024\)/)
  assert.match(archiveText, /FLAGGED/)
  assert.match(archiveText, /Albert A\. Vinluan, DIT/)
  assert.match(archiveText, /CHRISTINE CHARMAINE G\. SAN JOSE, DIT/)
})
