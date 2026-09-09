import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SORT_OPTIONS,
  archiveYears,
  filterArchivePapers,
  resolveArchivePrograms,
  resolveArchiveTracks,
  sortArchivePapers,
} from './archiveFilters.js'

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

test('archive filtering by thesis category treats legacy papers as student work', () => {
  const catalogued = [
    { id: 'legacy', department: 'CCSICT' },
    { id: 'student', department: 'CCSICT', thesis_category: 'student' },
    { id: 'faculty', department: 'CCSICT', thesis_category: 'faculty' },
  ]
  assert.deepEqual(
    filterArchivePapers(catalogued, { thesis_category: 'faculty' }).map((paper) => paper.id),
    ['faculty'],
  )
  // Pre-migration rows carry no field and are undergraduate work by definition.
  assert.deepEqual(
    filterArchivePapers(catalogued, { thesis_category: 'student' }).map((paper) => paper.id),
    ['legacy', 'student'],
  )
  assert.deepEqual(
    filterArchivePapers(catalogued, { thesis_category: '' }).map((paper) => paper.id),
    ['legacy', 'student', 'faculty'],
  )
})

test('archive filtering supports normalized program and specialization IDs', () => {
  const papers = [
    { id: 'one', department: 'CCSICT', program_id: 'bscs', specialization_id: 'dm' },
    { id: 'two', department: 'CCSICT', program_id: 'bsit', specialization_id: 'wmad' },
  ]
  assert.deepEqual(
    filterArchivePapers(papers, { program_id: 'bscs', specialization_id: 'dm' }).map((paper) => paper.id),
    ['one'],
  )
})

test('archive years and department-specific tracks are deterministic', () => {
  assert.deepEqual(archiveYears(papers), [2026, 2024])
  assert.deepEqual(resolveArchiveTracks({
    tracks: ['Fallback'],
    departments: [{ name: 'CCSICT', tracks: ['Data Mining'], track_label: 'Academic Track' }],
    selectedDepartment: 'CCSICT',
  }), { activeTracks: ['Data Mining'], trackLabel: 'academic track' })
})

test('the unscoped track label comes from the catalog, not the word "track"', () => {
  // A superadmin on "All depts" sees the union, which the normalized catalog
  // builds from specialization names plus the codes of the programs that take
  // none. Calling BLIS/BSDSA/BSIS "tracks" was wrong; the catalog's own label
  // is authoritative when every department agrees on it.
  const departments = [
    { name: 'CCSICT', tracks: ['Data Mining', 'BSIS'], track_label: 'Program / specialization' },
    { name: 'CAS', tracks: ['BSBIO'], track_label: 'Program / specialization' },
  ]
  assert.deepEqual(resolveArchiveTracks({
    tracks: ['Data Mining', 'BSIS', 'BSBIO'], departments, selectedDepartment: '',
  }), { activeTracks: ['Data Mining', 'BSIS', 'BSBIO'], trackLabel: 'program / specialization' })
  // An unknown selection falls back to the same union and the same label.
  assert.deepEqual(resolveArchiveTracks({
    tracks: ['Data Mining'], departments, selectedDepartment: 'Nope',
  }), { activeTracks: ['Data Mining'], trackLabel: 'program / specialization' })
})

test('a mixed or label-less catalog keeps the neutral track label', () => {
  // No single heading is true across disagreeing departments, and a legacy
  // (pre-PI-04) catalog publishes no label at all.
  assert.equal(resolveArchiveTracks({
    tracks: ['A'],
    departments: [
      { name: 'CCSICT', track_label: 'Program / specialization' },
      { name: 'CED', track_label: 'Academic track' },
    ],
  }).trackLabel, 'track')
  assert.equal(resolveArchiveTracks({ tracks: ['A'], departments: [{ name: 'CCSICT' }] }).trackLabel, 'track')
  assert.equal(resolveArchiveTracks({}).trackLabel, 'track')
})

test('normalized catalog options remain department-owned', () => {
  const departments = [{
    name: 'CCSICT',
    programs: [{
      id: 'bsit', code: 'BSIT',
      specializations: [{ id: 'wmad', code: 'WMAD' }],
    }],
  }]
  const options = resolveArchivePrograms({ departments, selectedDepartment: 'CCSICT', programId: 'bsit' })
  assert.deepEqual(options.programs.map((program) => program.code), ['BSIT'])
  assert.deepEqual(options.specializations.map((specialization) => specialization.code), ['WMAD'])
  assert.deepEqual(resolveArchivePrograms({ departments, selectedDepartment: 'Unknown' }), {
    programs: [], specializations: [],
  })
})

test('sortArchivePapers orders papers deterministically by multiple criteria', () => {
  const dataset = [
    { id: '1', title: 'Banana AI', year: 2024, created_at: '2024-01-01T00:00:00Z', authors: 'Alice', abstract: 'Deep learning' },
    { id: '2', title: 'Apple ML', year: 2026, created_at: '2026-05-01T00:00:00Z', authors: 'Bob', abstract: 'Neural networks' },
    { id: '3', title: 'Cherry Data', year: 2025, created_at: '2025-03-01T00:00:00Z', authors: 'Charlie Apple', abstract: 'Vision' },
  ]

  // Title A-Z and Z-A
  assert.deepEqual(sortArchivePapers(dataset, 'title_asc').map((p) => p.id), ['2', '1', '3'])
  assert.deepEqual(sortArchivePapers(dataset, 'title_desc').map((p) => p.id), ['3', '1', '2'])

  // Year descending and ascending
  assert.deepEqual(sortArchivePapers(dataset, 'year_desc').map((p) => p.id), ['2', '3', '1'])
  assert.deepEqual(sortArchivePapers(dataset, 'year_asc').map((p) => p.id), ['1', '3', '2'])

  // Newest and Oldest by created_at
  assert.deepEqual(sortArchivePapers(dataset, 'newest').map((p) => p.id), ['2', '3', '1'])
  assert.deepEqual(sortArchivePapers(dataset, 'oldest').map((p) => p.id), ['1', '3', '2'])

  // Relevance: 'Apple' in title ('Apple ML') beats author 'Charlie Apple'
  assert.deepEqual(sortArchivePapers(dataset, 'relevance', 'Apple').map((p) => p.id), ['2', '3', '1'])

  // Edge cases: null, empty
  assert.deepEqual(sortArchivePapers([], 'newest'), [])
  assert.deepEqual(sortArchivePapers(null, 'newest'), [])
  assert.ok(SORT_OPTIONS.length >= 5)
})
