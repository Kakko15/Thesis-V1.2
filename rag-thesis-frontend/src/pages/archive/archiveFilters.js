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
    const matchesYear = !filters.year || String(paper.year) === String(filters.year)
    const matchesDepartment = !filters.superadmin || !filters.department || paper.department === filters.department
    return matchesQuery && matchesTrack && matchesYear && matchesDepartment
  })
}

export function resolveArchiveTracks({ tracks = [], departments = [], selectedDepartment }) {
  if (!selectedDepartment) return { activeTracks: tracks, trackLabel: 'track' }
  const department = departments.find((item) => item?.name === selectedDepartment)
  if (!department) return { activeTracks: tracks, trackLabel: 'track' }
  return {
    activeTracks: Array.isArray(department.tracks) ? department.tracks : [],
    trackLabel: department.track_label?.toLowerCase() || 'track',
  }
}
