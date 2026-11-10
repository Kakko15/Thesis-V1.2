export const STUDENT_STARTER_PROMPTS = Object.freeze([
  {
    label: 'ML & AI methods in BSCS',
    prompt: 'What machine learning techniques were used in past CCSICT theses?',
  },
  {
    label: 'Web & mobile systems',
    prompt: 'Summarize recent web and mobile application theses in the archive.',
  },
  {
    label: 'Library & information studies',
    prompt: 'What BLIS studies have been conducted at Isabela State University?',
  },
  {
    label: 'Find unexplored topics',
    prompt: 'Which research areas or methodologies have the fewest studies in the archive?',
  },
])

export function formatRoleSubtitle(role, department) {
  if (role === 'superadmin') return 'Super Admin at System'
  const cleanRole = typeof role === 'string' && role.trim()
    ? (role === 'admin' ? 'Administrator' : `${role.trim()[0].toUpperCase()}${role.trim().slice(1).toLowerCase()}`)
    : 'Member'
  const cleanDept = typeof department === 'string' && department.trim() ? department.trim() : 'Unassigned'
  return `${cleanRole} at ${cleanDept}`
}

export function computeDashboardStats(papers, currentYear = new Date().getFullYear()) {
  const list = Array.isArray(papers) ? papers : []
  const tracks = new Set(list.map((p) => p?.track).filter(Boolean))
  const validYears = list
    .map((p) => Number(p?.year))
    .filter((yr) => Number.isFinite(yr) && yr > 1900)
  const distinctYearSet = new Set(validYears)
  const minWindowYear = currentYear - 4
  const recentWindowCount = validYears.filter((yr) => yr >= minWindowYear).length
  const chunks = list.reduce((acc, p) => acc + (Number(p?.chunk_count) || 0), 0)

  let yearRangeLabel = '—'
  if (validYears.length > 0) {
    const minYear = Math.min(...validYears)
    const maxYear = Math.max(...validYears)
    yearRangeLabel = minYear === maxYear ? `${minYear}` : `${minYear}–${maxYear}`
  }

  return {
    total: list.length,
    tracks: tracks.size,
    distinctYears: distinctYearSet.size,
    yearRangeLabel,
    recentWindowCount,
    chunks,
  }
}

export function groupPapersByTrack(papers) {
  const list = Array.isArray(papers) ? papers : []
  const counts = new Map()
  for (const paper of list) {
    const track = typeof paper?.track === 'string' ? paper.track.trim() : ''
    if (!track) continue
    counts.set(track, (counts.get(track) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([track, count]) => ({ track, count }))
    .sort((a, b) => b.count - a.count || a.track.localeCompare(b.track))
}

export function buildPaperChatPrompt(paper) {
  const title = typeof paper?.title === 'string' ? paper.title.trim() : ''
  if (!title) return 'Summarize the key findings and methodology of this thesis.'
  const yearSuffix = paper?.year ? ` (${paper.year})` : ''
  return `Summarize the objectives, methodology, and key findings of "${title}"${yearSuffix}.`
}

export function mfaNudgeStorageKey(userId) {
  const cleanId = typeof userId === 'string' && userId.trim() ? userId.trim() : 'anonymous'
  return `iskai_mfa_nudge_dismissed_${cleanId}`
}
