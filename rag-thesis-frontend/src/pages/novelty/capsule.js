// Capsule proposal form rules, mirrored from routers/duplication.py::
// CapsuleScanReq so the form refuses what the server would refuse, with the
// same limits, before a request is spent.

export const CAPSULE_FIELDS = Object.freeze([
  Object.freeze({
    key: 'title',
    label: 'Working title',
    hint: 'The specific focus of the study.',
    max: 300,
    rows: 0,
  }),
  Object.freeze({
    key: 'rationale',
    label: 'Rationale and significance',
    hint: 'The problem, the gap in what is known, and why it matters.',
    max: 6000,
    rows: 4,
  }),
  Object.freeze({
    key: 'objectives',
    label: 'Research questions / objectives',
    hint: 'What the study sets out to answer or achieve.',
    max: 6000,
    rows: 4,
  }),
  Object.freeze({
    key: 'methodology',
    label: 'Methodology',
    hint: 'Design, data gathering, and the analysis tools.',
    max: 6000,
    rows: 4,
  }),
])

export const MIN_TITLE_CHARACTERS = 5
export const MIN_SECTION_CHARACTERS = 40
export const EMPTY_CAPSULE = Object.freeze({ title: '', rationale: '', objectives: '', methodology: '' })

const DRAFT_KEY = 'isu-novelty-capsule-draft-v1'

function trimmed(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** Why the capsule cannot be screened yet, or '' when it can. */
export function capsuleError(capsule = {}) {
  if (trimmed(capsule.title).length < MIN_TITLE_CHARACTERS) {
    return `Add a working title (${MIN_TITLE_CHARACTERS} characters or more).`
  }
  const tooLong = CAPSULE_FIELDS.find((field) => String(capsule[field.key] ?? '').length > field.max)
  if (tooLong) return `${tooLong.label} is longer than ${tooLong.max.toLocaleString()} characters.`
  const body = CAPSULE_FIELDS.slice(1).some((field) => trimmed(capsule[field.key]).length >= MIN_SECTION_CHARACTERS)
  if (!body) {
    return `Add at least one of the rationale, the objectives, or the methodology (${MIN_SECTION_CHARACTERS} characters or more).`
  }
  return ''
}

/** Which sections will actually be screened: the title and every substantial body section. */
export function screenedSections(capsule = {}) {
  return CAPSULE_FIELDS.filter((field) => (
    field.key === 'title'
      ? trimmed(capsule.title).length >= MIN_TITLE_CHARACTERS
      : trimmed(capsule[field.key]).length >= MIN_SECTION_CHARACTERS
  )).map((field) => field.key)
}

/** The request body: trimmed, and only the four capsule fields. */
export function capsulePayload(capsule = {}) {
  return Object.fromEntries(CAPSULE_FIELDS.map((field) => [field.key, String(capsule[field.key] ?? '').trim()]))
}

// The draft is a per-viewer convenience -- a capsule is several paragraphs of
// typing -- so it lives in this browser only and every access is guarded:
// storage can be absent, full, or blocked, and the form must work without it.
export function loadCapsuleDraft(storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(storage?.getItem(DRAFT_KEY) || 'null')
    if (!stored || typeof stored !== 'object') return { ...EMPTY_CAPSULE }
    return Object.fromEntries(CAPSULE_FIELDS.map((field) => [
      field.key, typeof stored[field.key] === 'string' ? stored[field.key].slice(0, field.max) : '',
    ]))
  } catch {
    return { ...EMPTY_CAPSULE }
  }
}

export function saveCapsuleDraft(capsule, storage = globalThis.localStorage) {
  try {
    const empty = CAPSULE_FIELDS.every((field) => !trimmed(capsule?.[field.key]))
    if (empty) storage?.removeItem(DRAFT_KEY)
    else storage?.setItem(DRAFT_KEY, JSON.stringify(capsulePayload(capsule)))
  } catch {
    // Storage unavailable: the draft simply is not kept.
  }
}

/** True when a stored scan is a capsule screening rather than a manuscript one. */
export function isCapsuleScan(scan) {
  return Array.isArray(scan?.capsule_sections)
}

// What the capsule upload accepts: the server reads PDF, Word (.docx) and text.
export const CAPSULE_FILE_ACCEPT = '.pdf,.docx,.txt'
const CAPSULE_FILE_TYPES = new Set(['pdf', 'docx', 'txt'])
const MAX_CAPSULE_FILE_BYTES = 25 * 1024 * 1024

/** Why a file cannot be read as a capsule, or '' when it can. */
export function capsuleFileError(file) {
  if (!file) return 'No file.'
  const name = String(file.name || '').toLowerCase()
  const suffix = name.includes('.') ? name.split('.').pop() : ''
  if (!CAPSULE_FILE_TYPES.has(suffix)) {
    return suffix === 'doc'
      ? 'Save the capsule as a .docx (Word 2007 or later) or a PDF first.'
      : 'Upload the capsule as a PDF, a Word (.docx) document, or a text file.'
  }
  if (file.size > MAX_CAPSULE_FILE_BYTES) return 'Larger than the 25 MB limit.'
  return ''
}

/** The fields the upload would overwrite that already hold typed text. */
export function overwrittenFields(current = {}, extracted = {}) {
  return CAPSULE_FIELDS
    .filter((field) => String(extracted[field.key] ?? '').trim() && String(current[field.key] ?? '').trim())
    .filter((field) => String(extracted[field.key]).trim() !== String(current[field.key]).trim())
    .map((field) => field.key)
}

/**
 * The form after an upload: every section the file supplied replaces what was
 * there, and a section the file did not supply keeps what was typed.
 */
export function applyExtractedCapsule(current = {}, extracted = {}) {
  const capsule = { ...EMPTY_CAPSULE, ...current }
  const filled = []
  for (const field of CAPSULE_FIELDS) {
    const value = String(extracted[field.key] ?? '').slice(0, field.max).trim()
    if (value) {
      capsule[field.key] = value
      filled.push(field.key)
    }
  }
  return { capsule, filled }
}
