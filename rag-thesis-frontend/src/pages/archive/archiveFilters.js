export function archiveYears(papers = []) {
  return [...new Set(papers.filter(Boolean).map((paper) => paper.year).filter(Boolean))]
    .sort((left, right) => right - left)
}

export function filterArchivePapers(papers = [], filters = {}) {
  const query = (filters.query || '').trim().toLowerCase()
  return papers.filter(Boolean).filter((paper) => {
    const matchesQuery = !query || [paper.title, paper.authors, paper.abstract]
      .some((value) => String(value || '').toLowerCase().includes(query))
    const matchesTrack = !filters.track || paper.track === filters.track
    const matchesProgram = !filters.program_id || paper.program_id === filters.program_id
    const matchesSpecialization = !filters.specialization_id
      || paper.specialization_id === filters.specialization_id
    const matchesYear = !filters.year || String(paper.year) === String(filters.year)
    const matchesDepartment = !filters.superadmin || !filters.department || paper.department === filters.department
    // Papers indexed before the category migration carry no field and are
    // undergraduate work by definition, so they read as 'student'.
    const matchesCategory = !filters.thesis_category
      || (paper.thesis_category || 'student') === filters.thesis_category
    return matchesQuery && matchesTrack && matchesProgram
      && matchesSpecialization && matchesYear && matchesDepartment && matchesCategory
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

export function resolveArchivePrograms({ departments = [], selectedDepartment, programId = '' }) {
  const department = departments.find((item) => item?.name === selectedDepartment)
  const programs = Array.isArray(department?.programs) ? department.programs : []
  const program = programs.find((item) => item?.id === programId)
  return {
    programs,
    specializations: Array.isArray(program?.specializations) ? program.specializations : [],
  }
}
