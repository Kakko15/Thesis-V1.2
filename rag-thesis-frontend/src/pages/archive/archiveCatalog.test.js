import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveYears, filterArchivePapers, resolveArchiveTracks } from './archiveFilters.js'

const papers = [
  null,
  { id: '1', title: 'RAG Library', authors: null, abstract: 'Semantic search', year: 2026, track: 'Data Mining', department: 'CCSICT', duplication_scan: null },
  { id: '2', title: 'Network Study', authors: 'Researcher', year: 2024, track: 'Networks', department: 'CCSICT' },
]

test('archive filtering is legacy-safe and supports combined filters', () => {
  assert.deepEqual(filterArchivePapers(papers, { query: 'semantic' }).map((paper) => paper.id), ['1'])
  assert.deepEqual(filterArchivePapers(papers, { track: 'Networks', year: '2024' }).map((paper) => paper.id), ['2'])
  assert.deepEqual(filterArchivePapers(papers, { superadmin: true, department: 'OTHER' }), [])
})

test('archive years and department-specific tracks are deterministic', () => {
  assert.deepEqual(archiveYears(papers), [2026, 2024])
  assert.deepEqual(resolveArchiveTracks({
    tracks: ['Fallback'],
    departments: [{ name: 'CCSICT', tracks: ['Data Mining'], track_label: 'Academic Track' }],
    selectedDepartment: 'CCSICT',
  }), { activeTracks: ['Data Mining'], trackLabel: 'academic track' })
})
