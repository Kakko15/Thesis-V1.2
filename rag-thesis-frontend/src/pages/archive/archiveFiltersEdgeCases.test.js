import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARCHIVE_RETENTION_YEARS,
  archiveAdvisers,
  archiveYears,
  filterArchivePapers,
  isWithinRetentionWindow,
  resolveArchivePrograms,
  resolveArchiveTracks,
  resolveRecencyMinYear,
  sortArchivePapers,
  summarizeArchiveRetention,
  trackDisplayLabel,
  trackDisplayLabels,
} from './archiveFilters.js'

const CURRENT_YEAR = new Date().getFullYear()
const ids = (rows) => rows.map((paper) => paper.id)

test('resolveRecencyMinYear only bounds the recent_5 scope', () => {
  assert.equal(resolveRecencyMinYear('recent_5', 2026), 2021)
  assert.equal(resolveRecencyMinYear('recent_5', 2026, 3), 2023)
  // Defaults: the current year and the archive retention window.
  assert.equal(resolveRecencyMinYear('recent_5'), CURRENT_YEAR - ARCHIVE_RETENTION_YEARS)
  assert.equal(resolveRecencyMinYear('expired_5', 2026), null)
  assert.equal(resolveRecencyMinYear(''), null)
  assert.equal(resolveRecencyMinYear(undefined), null)
})

test('isWithinRetentionWindow keeps undated papers and defaults to the current year', () => {
  assert.equal(isWithinRetentionWindow(null, 2026), true)
  assert.equal(isWithinRetentionWindow('not a year', 2026), true)
  assert.equal(isWithinRetentionWindow(0, 2026), true)
  assert.equal(isWithinRetentionWindow(-4, 2026), true)
  assert.equal(isWithinRetentionWindow(Infinity, 2026), true)
  assert.equal(isWithinRetentionWindow('2023', 2026, 2), false)
  assert.equal(isWithinRetentionWindow('2024', 2026, 2), true)
  assert.equal(isWithinRetentionWindow(CURRENT_YEAR), true)
  assert.equal(isWithinRetentionWindow(CURRENT_YEAR - ARCHIVE_RETENTION_YEARS - 1), false)
})

test('summarizeArchiveRetention tolerates missing input and uses defaults', () => {
  const empty = summarizeArchiveRetention(null, 2026)
  assert.equal(empty.totalPapers, 0)
  assert.equal(empty.activeCount, 0)
  assert.equal(empty.expiredCount, 0)
  assert.equal(empty.estimatedVectorKb, 0)
  // Projection never assumes fewer than 100 papers: 100 * 5 * 120 / 1024.
  assert.equal(empty.projectedFiveYearMb, 58.6)

  const defaulted = summarizeArchiveRetention()
  assert.equal(defaulted.referenceYear, CURRENT_YEAR)
  assert.equal(defaulted.retentionYears, ARCHIVE_RETENTION_YEARS)
  assert.equal(defaulted.cutoffYear, CURRENT_YEAR - ARCHIVE_RETENTION_YEARS)
  assert.equal(defaulted.totalPapers, 0)

  const withCurrent = summarizeArchiveRetention([null, { year: CURRENT_YEAR }, { year: 1990 }])
  assert.equal(withCurrent.totalPapers, 2)
  assert.equal(withCurrent.activeCount, 1)
  assert.equal(withCurrent.expiredCount, 1)
  assert.equal(withCurrent.estimatedVectorKb, 240)
})

test('archiveYears and archiveAdvisers default to an empty archive', () => {
  assert.deepEqual(archiveYears(), [])
  assert.deepEqual(archiveAdvisers(), [])
  assert.deepEqual(archiveYears([{ year: null }, { year: 2020 }, { year: 2020 }]), [2020])
  assert.deepEqual(archiveAdvisers([{ adviser: '   ' }, { adviser: 'Zed' }, { adviser: 'Ana' }]), ['Ana', 'Zed'])
})

test('trackDisplayLabels skips malformed catalog rows and keeps the first label for a name', () => {
  assert.equal(trackDisplayLabels().size, 0)
  const labels = trackDisplayLabels([
    null,
    { name: 'NO_PROGRAMS' },
    {
      name: 'CCSICT',
      programs: [
        null,
        { code: 'BSIS' },
        {
          code: 'BSIT',
          specializations: [
            null,
            { code: 'X' },
            { name: 'Uncoded Major' },
            { code: 'NETSEC', name: 'Network and Security' },
          ],
        },
        // A second program claiming an existing name never overrides it.
        { code: 'BSCS', specializations: [{ code: 'NS', name: 'Network and Security' }] },
      ],
    },
  ])
  assert.equal(labels.size, 2)
  // A specialization without a code falls back to the bare program code.
  assert.equal(trackDisplayLabel(labels, 'Uncoded Major'), 'BSIT')
  assert.equal(trackDisplayLabel(labels, 'Network and Security'), 'BSIT (NETSEC)')
  assert.equal(trackDisplayLabel(new Map(), 'Raw'), 'Raw')
  assert.equal(trackDisplayLabel({}, 'NoGetter'), 'NoGetter')
  assert.equal(trackDisplayLabel(null, null), '')
})

test('a query without letters or digits falls back to a plain substring match', () => {
  const rows = [
    { id: 'plus', title: 'C++ for beginners' },
    { id: 'abstract', title: 'Systems', abstract: 'Uses ++ operators' },
    { id: 'none', title: 'Nothing here' },
  ]
  assert.deepEqual(ids(filterArchivePapers(rows, { query: '++' })), ['plus', 'abstract'])
  assert.deepEqual(ids(filterArchivePapers(rows, { query: '   ' })), ['plus', 'abstract', 'none'])
  assert.deepEqual(ids(filterArchivePapers(rows, { query: '##' })), [])
})

test('search tokens match by length: mid-word for 4+, whole words for 3, word start only for 1-2', () => {
  const rows = [
    { id: 'title-mid', title: 'Smart Motorcycle Gallery', year: 2025 },
    { id: 'abstract-start', title: 'Study', abstract: 'An otorhinolaryngology clinic.' },
    { id: 'abstract-mid', title: 'Study', abstract: 'A rotor design.' },
    { id: 'abs-word', title: 'Study', abstract: 'We use a cnn model.' },
    { id: 'abs-sub', title: 'Study', abstract: 'Uses cnns everywhere.' },
    { id: 'short', title: 'Study', abstract: 'xy coordinates' },
  ]
  // 4+ characters: mid-word in primary fields, word-start in the abstract.
  assert.deepEqual(ids(filterArchivePapers(rows, { query: 'otor' })), ['title-mid', 'abstract-start'])
  // Exactly 3 characters: only whole words in the abstract.
  assert.deepEqual(ids(filterArchivePapers(rows, { query: 'cnn' })), ['abs-word'])
  // 1-2 characters never match the abstract.
  assert.deepEqual(ids(filterArchivePapers(rows, { query: 'xy' })), [])
  // Numeric fields (the year) are searchable too.
  assert.deepEqual(ids(filterArchivePapers(rows, { query: '2025' })), ['title-mid'])
})

test('relevance scoring rewards title prefixes, word starts, substrings, people, panels and abstracts', () => {
  const rows = [
    { id: 'abstract', title: 'Zeta', abstract: 'Mentions robotics briefly', year: 2020 },
    { id: 'panel-chair', title: 'Eta', panel_chair: 'Robo Panelist', year: 2020 },
    { id: 'panel-member', title: 'Theta', panel_members: 'Dr. Robo', year: 2020 },
    { id: 'adviser', title: 'Iota', adviser: 'Engr. Robotnik', year: 2020 },
    { id: 'author', title: 'Kappa', authors: 'Robo, A.', year: 2020 },
    { id: 'title-mid', title: 'Microrobot swarms', year: 2020 },
    { id: 'title-word', title: 'Smart robot arms', year: 2020 },
    { id: 'title-start', title: 'Robotics lab', year: 2020 },
    { id: 'untitled', year: 2020 },
  ]
  assert.deepEqual(ids(sortArchivePapers(rows, 'relevance', 'robo')), [
    'title-start', // 60
    'title-word', // 45
    'title-mid', // 30
    'author', // 15
    'adviser', // 10
    'panel-chair', // 8 (ties broken by title)
    'panel-member', // 8
    'abstract', // 5
    'untitled', // 0
  ])
})

test('relevance ties fall back to newest order, and a blank query skips relevance', () => {
  const rows = [
    { id: 'old', title: 'Robot A', year: 2020 },
    { id: 'new', title: 'Robot A', year: 2024 },
  ]
  assert.deepEqual(ids(sortArchivePapers(rows, 'relevance', 'robot')), ['new', 'old'])
  assert.deepEqual(ids(sortArchivePapers(rows, 'newest', 'robot')), ['new', 'old'])
  // A whitespace-only query, or a sort other than relevance/newest, ignores the query.
  assert.deepEqual(ids(sortArchivePapers(rows, 'relevance', '   ')), ['new', 'old'])
  assert.deepEqual(ids(sortArchivePapers(rows, 'oldest', 'robot')), ['old', 'new'])
  assert.deepEqual(ids(sortArchivePapers(rows, 'relevance', null)), ['new', 'old'])
})

test('a query whose trimmed form is empty contributes no relevance', () => {
  // Defensive guard: a query object whose own trim() yields nothing scores zero
  // for every paper, so ordering falls back to newest first.
  const blankQuery = { toString: () => 'robot', trim: () => '' }
  const rows = [
    { id: 'match-old', title: 'Robot', year: 2019 },
    { id: 'plain-new', title: 'Other', year: 2025 },
  ]
  assert.deepEqual(ids(sortArchivePapers(rows, 'relevance', blankQuery)), ['plain-new', 'match-old'])
})

test('newest and oldest fall back from year to created_at to title, tolerating gaps', () => {
  const rows = [
    null,
    { id: 'undated-b', title: 'B' },
    { id: 'undated-a', title: 'A' },
    { id: 'undated-untitled' },
    { id: 'y2024-early', title: 'Z', year: 2024, created_at: '2024-01-01T00:00:00Z' },
    { id: 'y2024-late', title: 'Z', year: 2024, created_at: '2024-06-01T00:00:00Z' },
    { id: 'y2024-none', title: 'Z', year: 2024 },
    { id: 'y-bad', title: 'C', year: 'unknown' },
  ]
  assert.deepEqual(ids(sortArchivePapers(rows, 'newest')), [
    'y2024-late', 'y2024-early', 'y2024-none',
    'undated-untitled', 'undated-a', 'undated-b', 'y-bad',
  ])
  assert.deepEqual(ids(sortArchivePapers(rows, 'oldest')), [
    'undated-untitled', 'undated-a', 'undated-b', 'y-bad',
    'y2024-none', 'y2024-early', 'y2024-late',
  ])
  // Default sort is newest; an unknown sort also falls back to newest.
  assert.deepEqual(ids(sortArchivePapers(rows)), ids(sortArchivePapers(rows, 'newest')))
  assert.deepEqual(ids(sortArchivePapers(rows, 'bogus')), ids(sortArchivePapers(rows, 'newest')))
})

test('date ties fall back to titles in both directions, with untitled papers first', () => {
  const untitled = { id: 'untitled', year: 2020, created_at: '2020-01-01' }
  const titled = { id: 'titled', title: 'B', year: 2020, created_at: '2020-01-01' }
  for (const sortBy of ['oldest', 'newest']) {
    assert.deepEqual(ids(sortArchivePapers([untitled, titled], sortBy)), ['untitled', 'titled'])
    assert.deepEqual(ids(sortArchivePapers([titled, untitled], sortBy)), ['untitled', 'titled'])
  }
})

test('title and year comparators treat missing values as empty or zero', () => {
  const rows = [
    { id: 'b', title: 'Beta', year: 2022 },
    { id: 'none' },
    { id: 'a', title: 'Alpha', year: 2021 },
  ]
  assert.deepEqual(ids(sortArchivePapers(rows, 'title_asc')), ['none', 'a', 'b'])
  assert.deepEqual(ids(sortArchivePapers(rows, 'title_desc')), ['b', 'a', 'none'])
  assert.deepEqual(ids(sortArchivePapers(rows, 'year_desc')), ['b', 'a', 'none'])
  assert.deepEqual(ids(sortArchivePapers(rows, 'year_asc')), ['none', 'a', 'b'])
})

test('filterArchivePapers tolerates missing arguments and unknown catalog entries', () => {
  assert.deepEqual(filterArchivePapers(), [])
  const rows = [
    { id: 'legacy-cs', track: 'Data Mining' },
    { id: 'legacy-web', track: 'Web Development' },
    { id: 'no-track' },
  ]
  // A program without a specializations list still matches its own code and legacy names.
  const programs = [null, { id: 'bscs', code: 'BSCS' }]
  assert.deepEqual(ids(filterArchivePapers(rows, { program_id: 'bscs' }, programs)), ['legacy-cs'])
  // A specialization the program does not list falls back to program-level text matching.
  assert.deepEqual(
    ids(filterArchivePapers(rows, { program_id: 'bscs', specialization_id: 'ghost' }, programs)),
    ['legacy-cs'],
  )
  // An unknown program leaves only id matches, with or without a specialization.
  assert.deepEqual(ids(filterArchivePapers(rows, { program_id: 'missing' }, programs)), [])
  assert.deepEqual(
    ids(filterArchivePapers(rows, { program_id: 'missing', specialization_id: 'x' }, programs)),
    [],
  )
  // A specialization without a program never consults the legacy text.
  assert.deepEqual(
    ids(filterArchivePapers([{ id: 's', specialization_id: 'wmad' }, ...rows], { specialization_id: 'wmad' })),
    ['s'],
  )
  // Legacy map: a specialization filter matches its legacy track only for the right code.
  const bsit = [{ id: 'bsit', code: 'BSIT', specializations: [{ id: 'wmad', code: 'WMAD', name: 'WMAD Major' }] }]
  // A null catalog specialization entry is skipped when resolving the selection.
  const sparse = [{ id: 'bsit', code: 'BSIT', specializations: [null, { id: 'wmad', code: 'WMAD' }] }]
  assert.deepEqual(
    ids(filterArchivePapers(
      [{ id: 'cat', program_id: 'bsit', specialization_id: 'wmad' }, { id: 'other', program_id: 'bsit' }],
      { program_id: 'bsit', specialization_id: 'wmad' },
      sparse,
    )),
    ['cat'],
  )
  assert.deepEqual(
    ids(filterArchivePapers(rows, { program_id: 'bsit', specialization_id: 'wmad' }, bsit)),
    ['legacy-web'],
  )
  const bscsWithSpec = [{ id: 'bscs', code: 'BSCS', specializations: [{ id: 'dm', code: 'DM', name: 'DM Major' }] }]
  assert.deepEqual(
    ids(filterArchivePapers(rows, { program_id: 'bscs', specialization_id: 'dm' }, bscsWithSpec)),
    [],
  )
})

test('year, adviser, department and track filters combine', () => {
  const rows = [
    { id: 'a', year: 2024, adviser: ' Ana ', department: 'CCSICT', track: 'T1' },
    { id: 'b', year: 2023, department: 'CAS', track: 'T1' },
  ]
  assert.deepEqual(ids(filterArchivePapers(rows, { year: 2024 })), ['a'])
  assert.deepEqual(ids(filterArchivePapers(rows, { adviser: 'Ana' })), ['a'])
  // The department filter applies to superadmins only.
  assert.deepEqual(ids(filterArchivePapers(rows, { department: 'CAS' })), ['a', 'b'])
  assert.deepEqual(ids(filterArchivePapers(rows, { superadmin: true, department: 'CAS' })), ['b'])
  assert.deepEqual(ids(filterArchivePapers(rows, { superadmin: true, department: '' })), ['a', 'b'])
  assert.deepEqual(ids(filterArchivePapers(rows, { track: 'T2' })), [])
  // recent_5 defaults its reference to the current year when none is given.
  assert.deepEqual(
    ids(filterArchivePapers([{ id: 'now', year: CURRENT_YEAR }, { id: 'old', year: 1999 }], { year: 'recent_5' })),
    ['now'],
  )
})

test('resolveArchiveTracks handles malformed departments', () => {
  const departments = [null, { name: 'CCSICT', tracks: 'not-a-list' }, { name: 'CAS', track_label: 'Major' }]
  assert.deepEqual(
    resolveArchiveTracks({ tracks: ['X'], departments, selectedDepartment: 'CCSICT' }),
    { activeTracks: [], trackLabel: 'track' },
  )
  assert.deepEqual(
    resolveArchiveTracks({ departments, selectedDepartment: 'CAS' }),
    { activeTracks: [], trackLabel: 'major' },
  )
  // Unscoped: the only label present is used even if other departments omit it.
  assert.deepEqual(resolveArchiveTracks({ departments }), { activeTracks: [], trackLabel: 'major' })
})

test('resolveArchivePrograms defaults and skips malformed departments and programs', () => {
  assert.deepEqual(resolveArchivePrograms({}), { programs: [], specializations: [] })
  const departments = [
    null,
    { name: 'CCSICT', programs: 'oops' },
    { name: 'CAS', programs: [null, { id: 'bsbio', code: 'BSBIO', specializations: 'nope' }] },
  ]
  const unscoped = resolveArchivePrograms({ departments, programId: 'bsbio' })
  assert.equal(unscoped.programs.length, 2)
  assert.deepEqual(unscoped.specializations, [])
  assert.deepEqual(
    resolveArchivePrograms({ departments, selectedDepartment: 'CCSICT', programId: 'bsbio' }),
    { programs: [], specializations: [] },
  )
})
