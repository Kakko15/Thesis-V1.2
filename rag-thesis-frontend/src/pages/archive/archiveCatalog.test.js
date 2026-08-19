import test from 'node:test'
import assert from 'node:assert/strict'
import {
  archiveYears, filterArchivePapers, resolveArchivePrograms, resolveArchiveTracks,
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
