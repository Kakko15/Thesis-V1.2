export function archiveYears(papers = []) {
  return [...new Set(papers.filter(Boolean).map((paper) => paper.year).filter(Boolean))]
    .sort((left, right) => right - left)
}

/** Distinct recorded advisers, alphabetical. Papers indexed before the adviser
 * was captured carry none and simply do not contribute an option. */
export function archiveAdvisers(papers = []) {
  return [...new Set(
    papers.filter(Boolean).map((paper) => String(paper.adviser || '').trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right))
}

/**
 * Display names for the stored track values, keyed by the value itself.
 *
 * `papers.track` holds a specialization's name ("Network and Security") or,
 * for a program without specializations, the program's code ("BSIS"), so a
 * picker of raw values mixed full major names with course codes and never said
 * which program a major belonged to. Readers know the programs by code, so a
 * specialization reads as "BSIT (NETSEC)". A program with a single
 * specialization reads as its bare code, since "X (Y)" would distinguish it
 * from nothing. Only the label changes; the value stays the stored track so
 * filtering matches existing rows.
 */
export function trackDisplayLabels(departments = []) {
  const labels = new Map()
  for (const department of departments) {
    for (const program of department?.programs || []) {
      const specializations = program?.specializations || []
      for (const specialization of specializations) {
        if (!specialization?.name || labels.has(specialization.name)) continue
        labels.set(
          specialization.name,
          specializations.length === 1 || !specialization.code
            ? program.code
            : `${program.code} (${specialization.code})`,
        )
      }
    }
  }
  return labels
}

export function trackDisplayLabel(labels, track) {
  return labels?.get?.(track) || track || ''
}

export const SORT_OPTIONS = Object.freeze([
  { value: 'newest', label: 'Sort: Newest first' },
  { value: 'oldest', label: 'Sort: Oldest first' },
  { value: 'relevance', label: 'Sort: Most relevant' },
  { value: 'title_asc', label: 'Sort: Title (A–Z)' },
  { value: 'title_desc', label: 'Sort: Title (Z–A)' },
  { value: 'year_desc', label: 'Sort: Year (Newest)' },
  { value: 'year_asc', label: 'Sort: Year (Oldest)' },
])

function relevanceScore(paper, query) {
  if (!query || !paper) return 0
  const q = query.toLowerCase()
  const title = String(paper.title || '').toLowerCase()
  const authors = String(paper.authors || '').toLowerCase()
  const adviser = String(paper.adviser || '').toLowerCase()
  const abstract = String(paper.abstract || '').toLowerCase()
  let score = 0
  if (title.startsWith(q)) score += 50
  else if (title.includes(q)) score += 30
  if (authors.includes(q)) score += 15
  // A named person, so it outranks a passing mention in the abstract, but the
  // thesis's own authors stay the stronger match for a name.
  if (adviser.includes(q)) score += 10
  if (abstract.includes(q)) score += 5
  return score
}

function compareByNewest(left, right) {
  const timeDiff = new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime()
  if (timeDiff !== 0) return timeDiff
  const yDiff = (Number(right.year) || 0) - (Number(left.year) || 0)
  if (yDiff !== 0) return yDiff
  return String(left.title || '').localeCompare(String(right.title || ''))
}

function compareByOldest(left, right) {
  const timeDiff = new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
  if (timeDiff !== 0) return timeDiff
  return (Number(left.year) || 0) - (Number(right.year) || 0)
}

const COMPARATORS = {
  title_asc: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
  title_desc: (a, b) => String(b.title || '').localeCompare(String(a.title || '')),
  year_desc: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0),
  year_asc: (a, b) => (Number(a.year) || 0) - (Number(b.year) || 0),
  oldest: compareByOldest,
  newest: compareByNewest,
}

export function sortArchivePapers(papers = [], sortBy = 'newest', query = '') {
  if (!Array.isArray(papers) || papers.length === 0) return []
  const copy = papers.filter(Boolean)

  if (sortBy === 'relevance' && query) {
    return copy.sort((left, right) => {
      const diff = relevanceScore(right, query) - relevanceScore(left, query)
      return diff !== 0 ? diff : compareByNewest(left, right)
    })
  }

  const comparator = COMPARATORS[sortBy] || compareByNewest
  return copy.sort(comparator)
}

// The pre-catalog track names and the program/specialization codes they map
// onto, mirrored from services/catalog.py::LEGACY_CLASSIFICATIONS.
const LEGACY_TRACKS = Object.freeze({
  'Data Mining': ['BSCS', null],
  'Web Development': ['BSIT', 'WMAD'],
  'Network Security': ['BSIT', 'NETSEC'],
})

/**
 * Whether a paper with no program id still belongs to `program` (and, when
 * given, `specialization`) by the track text it was stamped with.
 *
 * The program and specialization pickers match on ids, but papers indexed
 * before the normalized catalog carry only `track`. The unscoped view used to
 * offer a track picker that found them; once it offered the program pickers
 * instead, those papers could only be found by free-text search. A catalog
 * track is the specialization's name or the program's code; a legacy one maps
 * through LEGACY_TRACKS.
 */
function legacyTrackMatches(paper, program, specialization) {
  if (paper.program_id || !paper.track || !program) return false
  const legacy = LEGACY_TRACKS[paper.track]
  if (specialization) {
    return paper.track === specialization.name
      || Boolean(legacy && legacy[0] === program.code && legacy[1] === specialization.code)
  }
  const names = new Set([program.code, ...(program.specializations || []).map((item) => item.name)])
  return names.has(paper.track) || Boolean(legacy && legacy[0] === program.code)
}

export function filterArchivePapers(papers = [], filters = {}, catalogPrograms = []) {
  const query = (filters.query || '').trim().toLowerCase()
  const program = filters.program_id
    ? catalogPrograms.find((item) => item?.id === filters.program_id)
    : null
  const specialization = filters.specialization_id
    ? (program?.specializations || []).find((item) => item?.id === filters.specialization_id)
    : null
  return papers.filter(Boolean).filter((paper) => {
    const matchesQuery = !query || [paper.title, paper.authors, paper.adviser, paper.abstract]
      .some((value) => String(value || '').toLowerCase().includes(query))
    const matchesTrack = !filters.track || paper.track === filters.track
    const matchesProgram = !filters.program_id || paper.program_id === filters.program_id
      || legacyTrackMatches(paper, program, null)
    const matchesSpecialization = !filters.specialization_id
      || paper.specialization_id === filters.specialization_id
      || legacyTrackMatches(paper, program, specialization)
    const matchesYear = !filters.year || String(paper.year) === String(filters.year)
    const matchesAdviser = !filters.adviser || String(paper.adviser || '').trim() === filters.adviser
    const matchesDepartment = !filters.superadmin || !filters.department || paper.department === filters.department
    // Papers indexed before the category migration carry no field and are
    // undergraduate work by definition, so they read as 'student'.
    const matchesCategory = !filters.thesis_category
      || (paper.thesis_category || 'student') === filters.thesis_category
    return matchesQuery && matchesTrack && matchesProgram
      && matchesSpecialization && matchesYear && matchesAdviser && matchesDepartment && matchesCategory
  })
}

/** Label for the unscoped list, taken from the catalog instead of hardcoded.
 *
 * A superadmin on "All depts" has no selected department, so both fallbacks
 * below used to render the literal "All tracks" over a list the normalized
 * catalog builds from specialization names plus the codes of the programs that
 * take none (routers/catalog.py::_nested_catalog) — BLIS, BSDSA and BSIS read
 * as courses under a heading that calls them tracks. The catalog already
 * publishes the right word per department ('Program / specialization'), so use
 * it whenever every department agrees and keep 'track' only for a mixed or
 * label-less catalog, where no single heading is true.
 */
function unscopedTrackLabel(departments) {
  const labels = new Set(
    departments
      .map((item) => item?.track_label?.toLowerCase())
      .filter(Boolean),
  )
  return labels.size === 1 ? [...labels][0] : 'track'
}

export function resolveArchiveTracks({ tracks = [], departments = [], selectedDepartment }) {
  const fallback = { activeTracks: tracks, trackLabel: unscopedTrackLabel(departments) }
  if (!selectedDepartment) return fallback
  const department = departments.find((item) => item?.name === selectedDepartment)
  if (!department) return fallback
  return {
    activeTracks: Array.isArray(department.tracks) ? department.tracks : [],
    trackLabel: department.track_label?.toLowerCase() || 'track',
  }
}

/**
 * Program and specialization options for the archive filters.
 *
 * With no department selected (a superadmin on "All departments") every
 * department's programs are offered. That view used to fall back to one
 * combined track picker, where a program and a program's major were rows of
 * the same list ("BSIT (NETSEC)" beside "BSIS"); the program and specialization
 * pickers keep the two levels apart, as the department-scoped view already did.
 * An unknown department still offers nothing.
 */
export function resolveArchivePrograms({ departments = [], selectedDepartment, programId = '' }) {
  const scoped = selectedDepartment
    ? departments.filter((item) => item?.name === selectedDepartment)
    : departments
  const programs = scoped.flatMap((department) => (
    Array.isArray(department?.programs) ? department.programs : []
  ))
  const program = programs.find((item) => item?.id === programId)
  return {
    programs,
    specializations: Array.isArray(program?.specializations) ? program.specializations : [],
  }
}
