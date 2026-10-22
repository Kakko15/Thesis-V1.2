import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SORT_OPTIONS,
  archiveAdvisers,
  archiveYears,
  filterArchivePapers,
  resolveArchivePrograms,
  resolveArchiveTracks,
  sortArchivePapers,
  trackDisplayLabel,
  trackDisplayLabels,
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

test('with no department selected the program and its majors stay separate pickers', () => {
  const departments = [
    { name: 'CCSICT', programs: [
      { id: 'bscs', code: 'BSCS', specializations: [] },
      { id: 'bsit', code: 'BSIT', specializations: [{ id: 'netsec', code: 'NETSEC' }, { id: 'wmad', code: 'WMAD' }] },
    ] },
    { name: 'CAS', programs: [{ id: 'bsbio', code: 'BSBIO', specializations: [] }] },
    { name: 'LEGACY' },
  ]
  const unscoped = resolveArchivePrograms({ departments, selectedDepartment: '' })
  assert.deepEqual(unscoped.programs.map((program) => program.code), ['BSCS', 'BSIT', 'BSBIO'])
  assert.deepEqual(unscoped.specializations, [])
  const bsit = resolveArchivePrograms({ departments, selectedDepartment: '', programId: 'bsit' })
  assert.deepEqual(bsit.specializations.map((item) => item.code), ['NETSEC', 'WMAD'])
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

test('the archive search finds a thesis by its adviser and ranks that between authors and abstract', () => {
  const advised = [
    { id: 'abstract', title: 'Study A', abstract: 'Reviewed by Bautista', created_at: '2026-03-01' },
    { id: 'adviser', title: 'Study B', adviser: 'Dr. Liza M. Bautista', created_at: '2026-02-01' },
    { id: 'author', title: 'Study C', authors: 'Bautista, R.', created_at: '2026-01-01' },
    { id: 'unrelated', title: 'Study D', created_at: '2026-04-01' },
  ]
  const matched = filterArchivePapers(advised, { query: 'bautista' })
  assert.deepEqual(matched.map((paper) => paper.id).sort(), ['abstract', 'adviser', 'author'])
  assert.deepEqual(
    sortArchivePapers(matched, 'relevance', 'bautista').map((paper) => paper.id),
    ['author', 'adviser', 'abstract'],
  )
  // Papers indexed before the adviser was recorded carry none, and still filter.
  assert.deepEqual(filterArchivePapers(papers, { query: 'network' }).map((paper) => paper.id), ['2'])
})

test('track labels name the program, and the specialization only when it distinguishes', () => {
  const labels = trackDisplayLabels([{
    name: 'CCSICT',
    programs: [
      { code: 'BSCS', specializations: [{ code: 'DM', name: 'Data Mining' }] },
      {
        code: 'BSIT',
        specializations: [
          { code: 'NETSEC', name: 'Network and Security' },
          { code: 'WMAD', name: 'Web and Mobile Application Development' },
        ],
      },
      { code: 'BSIS', specializations: [] },
    ],
  }])
  assert.equal(trackDisplayLabel(labels, 'Data Mining'), 'BSCS')
  assert.equal(trackDisplayLabel(labels, 'Network and Security'), 'BSIT (NETSEC)')
  assert.equal(trackDisplayLabel(labels, 'Web and Mobile Application Development'), 'BSIT (WMAD)')
  // Program codes are already their own label, and an unknown value passes through.
  assert.equal(trackDisplayLabel(labels, 'BSIS'), 'BSIS')
  assert.equal(trackDisplayLabel(labels, 'Legacy Track'), 'Legacy Track')
  assert.equal(trackDisplayLabel(undefined, ''), '')
})

test('the adviser filter lists recorded advisers once and matches them exactly', () => {
  const advised = [
    null,
    { id: 'a', adviser: 'Albert A. Vinluan, DIT' },
    { id: 'b', adviser: ' Albert A. Vinluan, DIT ' },
    { id: 'c', adviser: 'Maria Santos' },
    { id: 'd', adviser: null },
  ]
  assert.deepEqual(archiveAdvisers(advised), ['Albert A. Vinluan, DIT', 'Maria Santos'])
  assert.deepEqual(
    filterArchivePapers(advised, { adviser: 'Albert A. Vinluan, DIT' }).map((paper) => paper.id),
    ['a', 'b'],
  )
  assert.deepEqual(filterArchivePapers(advised, { adviser: '' }).map((paper) => paper.id), ['a', 'b', 'c', 'd'])
})

test('a program filter also finds pre-catalog papers by the track they carry', () => {
  const programs = [
    { id: 'bscs', code: 'BSCS', specializations: [] },
    { id: 'bsit', code: 'BSIT', specializations: [
      { id: 'wmad', code: 'WMAD', name: 'Web and Mobile Application Development' },
      { id: 'netsec', code: 'NETSEC', name: 'Network and Security' },
    ] },
  ]
  const rows = [
    { id: 'catalogued', program_id: 'bsit', specialization_id: 'wmad', track: 'Web and Mobile Application Development' },
    { id: 'legacy-name', program_id: null, track: 'Web Development' },
    { id: 'catalog-name', program_id: null, track: 'Network and Security' },
    { id: 'restamped', program_id: null, track: 'BSCS' },
    { id: 'legacy-dm', program_id: null, track: 'Data Mining' },
    { id: 'unclassified', program_id: null, track: 'Intelligent Systems' },
    // A catalogued paper is matched on its id alone, never on its text.
    { id: 'other-program', program_id: 'bscs', track: 'Web Development' },
  ]
  const ids = (filters) => filterArchivePapers(rows, filters, programs).map((paper) => paper.id)
  assert.deepEqual(ids({ program_id: 'bsit' }), ['catalogued', 'legacy-name', 'catalog-name'])
  assert.deepEqual(ids({ program_id: 'bsit', specialization_id: 'wmad' }), ['catalogued', 'legacy-name'])
  assert.deepEqual(ids({ program_id: 'bsit', specialization_id: 'netsec' }), ['catalog-name'])
  assert.deepEqual(ids({ program_id: 'bscs' }), ['restamped', 'legacy-dm', 'other-program'])
  // Without the catalog to read, only ids match, as before.
  assert.deepEqual(filterArchivePapers(rows, { program_id: 'bsit' }).map((paper) => paper.id), ['catalogued'])
})
