export const MAX_COMPARE_PAPERS = 3
export const MAX_SAVED_PAPERS = 50
export const READING_LIST_EVENT = 'iskai:reading-list-change'

const PRESERVED_ACRONYMS = new Map([
  ['ai', 'AI'],
  ['rag', 'RAG'],
  ['llm', 'LLM'],
  ['llms', 'LLMs'],
  ['iot', 'IoT'],
  ['cnn', 'CNN'],
  ['cnns', 'CNNs'],
  ['bscs', 'BSCS'],
  ['bsit', 'BSIT'],
  ['blis', 'BLIS'],
  ['bsis', 'BSIS'],
  ['bsdsa', 'BSDSA'],
  ['ccsict', 'CCSICT'],
  ['isu', 'ISU'],
  ['isu-canner', 'ISU-CANNER'],
  ['qr', 'QR'],
  ['rfid', 'RFID'],
  ['sms', 'SMS'],
  ['api', 'API'],
  ['erds', 'ERDs'],
  ['nlp', 'NLP'],
  ['ocr', 'OCR'],
  ['3d', '3D'],
  ['2fa', '2FA'],
])

const COMPOUND_SURNAME_PREFIXES = new Set([
  'de', 'del', 'dela', 'delos', 'san', 'sta', 'sta.', 'st', 'st.', 'van', 'von',
])

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'])

function formatWordSegment(segment, capitalizeFirst) {
  const clean = segment.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
  const lower = clean.toLowerCase()
  if (PRESERVED_ACRONYMS.has(lower)) {
    return segment.replace(
      new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      PRESERVED_ACRONYMS.get(lower),
    )
  }
  const lowered = segment.toLowerCase()
  return capitalizeFirst
    ? lowered.replace(/[a-z]/, (ch) => ch.toUpperCase())
    : lowered
}

export function toSentenceCaseTitle(title) {
  const raw = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : ''
  if (!raw) return 'Untitled study'

  const letters = raw.replace(/[^a-zA-Z]/g, '')
  const upperCount = letters.replace(/[^A-Z]/g, '').length
  const isAllCaps = letters.length > 0 && upperCount / letters.length >= 0.75
  if (!isAllCaps) return raw

  const words = raw.split(' ')
  let capitalizeNext = true

  return words
    .map((token) => {
      const clean = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9-]+$/g, '')
      const lower = clean.toLowerCase()
      const hadColon = token.endsWith(':')

      if (PRESERVED_ACRONYMS.has(lower)) {
        const replacement = token.replace(
          new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          PRESERVED_ACRONYMS.get(lower),
        )
        capitalizeNext = hadColon
        return replacement
      }

      if (token.includes('-')) {
        const parts = token.split('-')
        const formattedParts = parts.map((seg, idx) => formatWordSegment(seg, idx === 0 && capitalizeNext))
        capitalizeNext = hadColon
        return formattedParts.join('-')
      }

      const formatted = formatWordSegment(token, capitalizeNext)
      capitalizeNext = hadColon
      return formatted
    })
    .join(' ')
}

function formatSingleAuthorApa(rawName) {
  const cleaned = rawName
    .replace(/\b(DIT|MIT|PhD|EdD|MSCS|MSIT|CPA|LPT|Inst\.?|Prof\.?|Dr\.?|Engr\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''

  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0]

  let suffix = ''
  if (parts.length > 2 && NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    suffix = `, ${parts.pop()}`
  }

  let surnameStart = parts.length - 1
  if (surnameStart >= 2 && COMPOUND_SURNAME_PREFIXES.has(parts[surnameStart - 1].toLowerCase())) {
    surnameStart -= 1
  }

  const surname = parts.slice(surnameStart).join(' ')
  const givenParts = parts.slice(0, surnameStart)
  const initials = givenParts
    .map((part) => {
      const alpha = part.replace(/[^a-zA-Z]/g, '')
      return alpha ? `${alpha[0].toUpperCase()}.` : ''
    })
    .filter(Boolean)
    .join(' ')

  return initials ? `${surname}, ${initials}${suffix}` : `${surname}${suffix}`
}

export function formatAuthorsApa(authors) {
  const raw = typeof authors === 'string' ? authors.trim() : ''
  if (!raw || /^unknown(\s+authors)?$/i.test(raw)) return 'Anonymous'

  const list = raw
    .replace(/\s+(?:and|&)\s+/gi, ', ')
    .split(/[;,]/)
    .map((item) => formatSingleAuthorApa(item))
    .filter(Boolean)

  if (list.length === 0) return 'Anonymous'
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]}, & ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}`
}

export function formatApaCitation(paper) {
  const authorBlock = formatAuthorsApa(paper?.authors)
  const yearBlock = paper?.year ? String(paper.year) : 'n.d.'
  const titleBlock = toSentenceCaseTitle(paper?.title).replace(/\.$/, '')
  const isFaculty = paper?.thesis_category === 'faculty'
  const workType = isFaculty
    ? 'Faculty research, Isabela State University – Echague Campus'
    : 'Undergraduate thesis, Isabela State University – Echague Campus'
  const dept = typeof paper?.department === 'string' && paper.department.trim()
    ? `${paper.department.trim()} Thesis Archive`
    : 'ISU Thesis Archive'
  return `${authorBlock} (${yearBlock}). ${titleBlock} [${workType}]. ${dept}.`
}

export function formatBibtexCitation(paper) {
  const rawAuthors = typeof paper?.authors === 'string' && paper.authors.trim() && !/^unknown/i.test(paper.authors.trim())
    ? paper.authors
        .replace(/\s+(?:and|&)\s+/gi, ', ')
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' and ')
    : 'Anonymous'
  const firstSurname = formatAuthorsApa(paper?.authors)
    .split(',')[0]
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase() || 'thesis'
  const year = paper?.year ? String(paper.year) : 'nd'
  const firstWord = (typeof paper?.title === 'string' ? paper.title : '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .find((w) => w.length >= 3 && !['the', 'and', 'for', 'with'].includes(w)) || 'study'
  const citeKey = `${firstSurname}${year}${firstWord}`
  const title = toSentenceCaseTitle(paper?.title)
  const dept = typeof paper?.department === 'string' && paper.department.trim() ? paper.department.trim() : 'CCSICT'
  const trackNote = paper?.track ? `,\n  note = {Track: ${paper.track}}` : ''

  return (
    `@mastersthesis{${citeKey},\n`
    + `  title = {${title}},\n`
    + `  author = {${rawAuthors}},\n`
    + `  year = {${paper?.year || 'n.d.'}},\n`
    + `  school = {Isabela State University -- Echague Campus (${dept})}${trackNote}\n`
    + `}`
  )
}

export function readingListStorageKey(userId) {
  const clean = typeof userId === 'string' && userId.trim() ? userId.trim() : 'guest'
  return `iskai_reading_list_${clean}`
}

export function parseSavedPaperIds(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const unique = []
    const seen = new Set()
    for (const item of parsed) {
      if (item === null || item === undefined) continue
      const id = String(item).trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      unique.push(id)
      if (unique.length >= MAX_SAVED_PAPERS) break
    }
    return unique
  } catch {
    return []
  }
}

export function readSavedPaperIds(userId) {
  if (typeof window === 'undefined') return []
  try {
    return parseSavedPaperIds(window.localStorage.getItem(readingListStorageKey(userId)))
  } catch {
    return []
  }
}

export function getReadingListSnapshot(userId) {
  if (typeof window === 'undefined') return '[]'
  try {
    return window.localStorage.getItem(readingListStorageKey(userId)) || '[]'
  } catch {
    return '[]'
  }
}

export function subscribeReadingList(callback) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(READING_LIST_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(READING_LIST_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function writeSavedPaperIds(userId, ids) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(readingListStorageKey(userId), JSON.stringify(ids))
    window.dispatchEvent(new CustomEvent(READING_LIST_EVENT, { detail: { userId, ids } }))
  } catch {
    // Ignore storage quota errors in private browsing.
  }
}

export function toggleSavedPaperId(currentIds, paperId) {
  const list = Array.isArray(currentIds) ? currentIds.map(String) : []
  const target = String(paperId ?? '').trim()
  if (!target) return { nextIds: list, saved: false }
  if (list.includes(target)) {
    return { nextIds: list.filter((id) => id !== target), saved: false }
  }
  return {
    nextIds: [target, ...list].slice(0, MAX_SAVED_PAPERS),
    saved: true,
  }
}

export function toggleComparePaperId(currentIds, paperId) {
  const list = Array.isArray(currentIds) ? currentIds.map(String) : []
  const target = String(paperId ?? '').trim()
  if (!target) return { nextIds: list, added: false, capped: false }
  if (list.includes(target)) {
    return { nextIds: list.filter((id) => id !== target), added: false, capped: false }
  }
  if (list.length >= MAX_COMPARE_PAPERS) {
    return { nextIds: list, added: false, capped: true }
  }
  return { nextIds: [...list, target], added: true, capped: false }
}

export function buildComparisonPrompt(papers) {
  const list = Array.isArray(papers) ? papers.filter((p) => p?.title) : []
  if (list.length === 0) return ''
  const labels = list
    .map((p, idx) => {
      const meta = [p.year, p.track].filter(Boolean).join(', ')
      return `${idx + 1}. "${p.title}"${meta ? ` (${meta})` : ''}`
    })
    .join('; ')
  return (
    `Compare the following ${list.length} archived theses side by side — ${labels} — `
    + 'focusing on their research objectives, methodologies, key findings, and unexplored research gaps.'
  )
}

export function buildReadingListExport(papers) {
  const list = Array.isArray(papers) ? papers.filter(Boolean) : []
  const header = [
    `ISKAI THESIS ARCHIVE — SAVED RRL READING LIST (${list.length} ${list.length === 1 ? 'STUDY' : 'STUDIES'})`,
    'Isabela State University – Echague Campus (CCSICT)',
    '========================================================================',
    '',
    'APA 7TH EDITION REFERENCES',
    '--------------------------',
  ]
  const apaLines = list.map((p, idx) => `${idx + 1}. ${formatApaCitation(p)}`)
  const bibHeader = [
    '',
    'BIBTEX ENTRIES',
    '--------------',
  ]
  const bibLines = list.map((p) => formatBibtexCitation(p))
  return [...header, ...apaLines, ...bibHeader, ...bibLines, ''].join('\n')
}
