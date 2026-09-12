import { uploadMetadataErrors } from './uploadState.js'
import { programSelection } from '../../lib/catalog.js'

/**
 * Pure state for the batch upload page: selected files, per-row metadata and
 * classification, the department shared by them all, submit results, and
 * polled job statuses.
 *
 * Kept free of React so every transition is unit-testable with node:test.
 */

export const BATCH_STEPS = Object.freeze({ files: 0, review: 1, ingesting: 2 })

/** Rail/stepper copy for the batch wizard, shaped like the single-upload one. */
export const BATCH_WIZARD_STEPS = Object.freeze([
  Object.freeze({ key: 'files', label: 'Manuscripts', hint: 'Choose the PDFs' }),
  Object.freeze({ key: 'review', label: 'Review', hint: 'Check every record' }),
  Object.freeze({ key: 'ingest', label: 'Ingest', hint: 'Watch the workers' }),
])

/**
 * What the batch rail shows. Unlike the single wizard it keeps the rail after
 * the last job lands: the page still lists per-row outcomes underneath, so the
 * finished ring is a summary of the table rather than a duplicate of a
 * full-width success screen.
 */
export function batchRailMode(step) {
  return step === BATCH_STEPS.ingesting ? 'progress' : 'summary'
}
// Mirrors the backend default `max_batch_files`; the server still enforces it.
export const MAX_BATCH_FILES = 20
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'cancelled', 'expired'])
// A job missing from three consecutive polls has expired server-side (or was
// never this user's); after that the row stops waiting for it.
export const MISSING_POLLS_BEFORE_EXPIRED = 3
export const ACTIVE_BATCH_STORAGE_KEY = 'activeUploadBatch'

// The program joined the row keys when a batch stopped being one program's
// worth of theses: a shelf holds whatever degrees the college awards, and
// requiring one program per request meant uploading the shelf once per degree.
// The department stays shared because the server pins it for everyone but a
// superadmin, and the category with it.
const ROW_METADATA_KEYS = ['title', 'authors', 'year', 'program_id', 'specialization_id']
const DEFAULT_KEYS = ['department']

export function fileValidationError(file) {
  if (!file) return 'No file selected'
  const validMime = !file.type || ['application/pdf', 'application/x-pdf'].includes(file.type)
  if (!file.name?.toLowerCase().endsWith('.pdf') || !validMime) return 'Only PDF manuscripts are accepted'
  if (file.size > MAX_FILE_BYTES) return 'Maximum size is 25 MB'
  return null
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createBatchRow(file, ids = {}) {
  return {
    // Stable per-row identity: array indexes would misapply state when a row
    // is removed (src/lib/keys.js), and the idempotency key must survive a
    // failed submit so the retry is idempotent.
    id: ids.id ?? randomId(),
    idempotencyKey: ids.idempotencyKey ?? randomId(),
    file,
    name: file.name,
    size: file.size,
    title: '',
    authors: '',
    year: '',
    // This manuscript's own classification, read from its own title page.
    program_id: '',
    specialization_id: '',
    requires_specialization: false,
    track: '',
    extracted: false,
    extractError: null,
    errors: {},
    jobId: null,
    submitError: null,
    submitStatusCode: null,
    job: null,
    missingPolls: 0,
  }
}

/** What the whole batch shares: only the two fields that genuinely are shared. */
export function emptyBatchDefaults(department = 'CCSICT') {
  return {
    department,
    thesis_category: 'student',
  }
}

export function createBatchState(department = 'CCSICT') {
  return {
    step: BATCH_STEPS.files,
    // Which way the wizard last moved, so Back reverses the slide.
    direction: 1,
    rows: [],
    defaults: emptyBatchDefaults(department),
    defaultErrors: {},
    extracting: false,
    submitting: false,
    uploadProgress: 0,
    pollError: '',
  }
}

function fileKey(file) {
  return `${file.name} ${file.size}`
}

function addRows(state, files) {
  const present = new Set(state.rows.map((row) => fileKey(row)))
  const additions = []
  for (const file of files) {
    const key = fileKey(file)
    if (present.has(key)) continue
    present.add(key)
    additions.push(createBatchRow(file))
  }
  const rows = [...state.rows, ...additions].slice(0, MAX_BATCH_FILES)
  return { ...state, rows }
}

function updateRow(state, id, patch) {
  return {
    ...state,
    rows: state.rows.map((row) => (row.id === id ? { ...row, ...(typeof patch === 'function' ? patch(row) : patch) } : row)),
  }
}

/**
 * Fold the title-page extraction into the rows it was run for.
 *
 * `departments` and the batch's own department are passed in so the extracted
 * program *code* can be resolved to the catalog row the form submits. Codes
 * from another college resolve to nothing and the row simply keeps its empty
 * program, which is the same fail-safe the single wizard uses.
 */
function applyExtraction(state, files, departments) {
  const byIndex = new Map((files ?? []).map((entry) => [entry.index, entry]))
  return {
    ...state,
    rows: state.rows.map((row, index) => {
      const entry = byIndex.get(index)
      if (!entry) return row
      if (entry.error) return { ...row, extracted: true, extractError: entry.error }
      // Never overwrite a program already chosen for this row by hand or by
      // "apply to all", the same rule the text fields follow.
      const selection = row.program_id ? null : programSelection(
        departments, state.defaults.department, entry.program_code, entry.specialization_code,
      )
      return {
        ...row,
        extracted: true,
        extractError: null,
        title: row.title || entry.title || '',
        authors: row.authors || entry.authors || '',
        year: row.year || String(entry.year ?? ''),
        ...(selection || {}),
      }
    }),
  }
}

/**
 * Put one classification on every row of the batch.
 *
 * The common case is still a shelf from a single degree, and making someone
 * set twenty dropdowns by hand to say so would trade one chore for a worse
 * one. Deliberately overwrites: it is an explicit bulk edit, not a default the
 * rows inherit, so after it runs each row still shows what it will be filed as.
 */
function applyProgramToRows(state, selection) {
  return {
    ...state,
    // A rejected row is on its way out of the batch rather than into an
    // archive, so it is left alone rather than classified.
    rows: state.rows.map((row) => (row.extractError ? row : { ...row, ...selection })),
  }
}

function applySubmitResults(state, results, rowIds) {
  // `rowIds` maps a result index back to a row when only a subset of the rows
  // was (re)submitted; without it the results align with every row in order.
  const byRowId = new Map((results ?? []).map((entry) => [
    rowIds ? rowIds[entry.index] : state.rows[entry.index]?.id, entry,
  ]))
  return {
    ...state,
    rows: state.rows.map((row) => {
      const result = byRowId.get(row.id)
      if (!result) return row
      if (result.job_id) {
        return {
          ...row,
          jobId: result.job_id,
          submitError: null,
          submitStatusCode: null,
          job: row.job ?? {
            status: result.status || 'queued', stage: 'download', progress: 8,
            message: result.message || 'Queued for the durable worker.',
          },
        }
      }
      return { ...row, submitError: result.error || 'This file was not accepted.', submitStatusCode: result.status_code ?? null }
    }),
  }
}

function applyJobStatuses(state, jobs) {
  const byId = new Map((jobs ?? []).map((job) => [job.job_id, job]))
  return {
    ...state,
    rows: state.rows.map((row) => {
      if (!row.jobId || isTerminal(row.job)) return row
      const job = byId.get(row.jobId)
      if (job) return { ...row, job, missingPolls: 0 }
      const missingPolls = row.missingPolls + 1
      if (missingPolls >= MISSING_POLLS_BEFORE_EXPIRED) {
        return {
          ...row,
          missingPolls,
          job: { ...(row.job ?? {}), status: 'expired', progress: row.job?.progress ?? 0, message: 'This upload job has expired or is no longer visible.' },
        }
      }
      return { ...row, missingPolls }
    }),
  }
}

export function batchReducer(state, action) {
  switch (action.type) {
    case 'add-rows': return addRows(state, action.files)
    case 'remove-row': return { ...state, rows: state.rows.filter((row) => row.id !== action.id) }
    case 'set-row-field': return updateRow(state, action.id, { [action.key]: action.value })
    // Choosing a program rewrites four fields at once, so it cannot go through
    // the single-key action without leaving the row half-classified in between.
    case 'patch-row': return updateRow(state, action.id, action.patch)
    case 'apply-extraction': return applyExtraction(state, action.files, action.departments)
    case 'apply-program': return applyProgramToRows(state, action.selection)
    case 'set-defaults-field': return { ...state, defaults: { ...state.defaults, [action.key]: action.value } }
    case 'set-defaults': return {
      ...state,
      defaults: typeof action.value === 'function' ? action.value(state.defaults) : action.value,
    }
    case 'set-default-errors': return { ...state, defaultErrors: action.errors }
    case 'set-row-errors': return {
      ...state,
      rows: state.rows.map((row) => ({ ...row, errors: action.errorsById[row.id] ?? {} })),
    }
    case 'set-step': return {
      ...state,
      step: action.step,
      direction: action.step < state.step ? -1 : 1,
    }
    case 'set-extracting': return { ...state, extracting: action.value }
    case 'set-submitting': return { ...state, submitting: action.value }
    case 'set-upload-progress': return { ...state, uploadProgress: action.value }
    case 'apply-submit-results': return applySubmitResults(state, action.results, action.rowIds)
    case 'apply-job-statuses': return applyJobStatuses(state, action.jobs)
    case 'set-poll-error': return { ...state, pollError: action.value }
    case 'restore': return { ...state, rows: action.rows, step: BATCH_STEPS.ingesting, direction: 1 }
    case 'reset': return createBatchState(action.department)
    default: return state
  }
}

/**
 * Partition the single-upload validator's output: title, year and the
 * manuscript's own program belong to the row; the department belongs to the
 * shared card. One validator, so a batch row is held to exactly the rules a
 * single upload is.
 */
export function splitMetadataErrors(row, defaults) {
  const errors = uploadMetadataErrors({
    ...defaults,
    title: row.title ?? '',
    authors: row.authors ?? '',
    year: row.year ?? '',
    program_id: row.program_id ?? '',
    specialization_id: row.specialization_id ?? '',
    requires_specialization: Boolean(row.requires_specialization),
  })
  const rowErrors = {}
  const defaultErrors = {}
  for (const [key, message] of Object.entries(errors)) {
    if (ROW_METADATA_KEYS.includes(key)) rowErrors[key] = message
    else if (DEFAULT_KEYS.includes(key)) defaultErrors[key] = message
  }
  return { rowErrors, defaultErrors }
}

export function validateBatch(rows, defaults) {
  const rowErrorsById = {}
  let defaultErrors = {}
  for (const row of rows) {
    const split = splitMetadataErrors(row, defaults)
    if (row.extractError) split.rowErrors.file = `Remove this file: ${row.extractError}`
    if (Object.keys(split.rowErrors).length) rowErrorsById[row.id] = split.rowErrors
    defaultErrors = { ...defaultErrors, ...split.defaultErrors }
  }
  if (rows.length === 0) {
    defaultErrors = { ...defaultErrors, rows: 'Add at least one manuscript' }
  }
  const valid = Object.keys(rowErrorsById).length === 0 && Object.keys(defaultErrors).length === 0
  return { rowErrorsById, defaultErrors, valid }
}

export function isTerminal(job) {
  return Boolean(job && TERMINAL_STATUSES.includes(job.status))
}

export function activeJobIds(rows) {
  return rows.filter((row) => row.jobId && !isTerminal(row.job)).map((row) => row.jobId)
}

export function allTerminal(rows) {
  return rows.length > 0 && rows.every((row) => !row.jobId || isTerminal(row.job))
}

export function batchSummary(rows) {
  const summary = {
    total: rows.length, accepted: 0, rejected: 0, queued: 0, processing: 0,
    retrying: 0, completed: 0, failed: 0, cancelled: 0, expired: 0,
  }
  for (const row of rows) {
    if (row.submitError) { summary.rejected += 1; continue }
    if (!row.jobId) continue
    summary.accepted += 1
    const status = row.job?.status ?? 'queued'
    if (status === 'completed') summary.completed += 1
    else if (status === 'failed') summary.failed += 1
    else if (status === 'cancelled') summary.cancelled += 1
    else if (status === 'expired') summary.expired += 1
    else if (status === 'retry_wait') summary.retrying += 1
    else if (status === 'processing') summary.processing += 1
    else summary.queued += 1
  }
  return summary
}

export function statusTone(status) {
  if (status === 'completed') return 'forest'
  if (status === 'retry_wait') return 'gold'
  if (status === 'failed' || status === 'expired' || status === 'cancelled') return 'flame'
  return 'neutral'
}

export function statusLabel(status) {
  const labels = {
    staging: 'Staging', queued: 'Queued', processing: 'Processing', retry_wait: 'Retrying',
    completed: 'Indexed', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired',
  }
  return labels[status] ?? (status || 'Pending')
}

const STAGE_LABELS = {
  queued: 'In queue', store: 'Securing source', download: 'Securing source', malware_scan: 'Malware scan', extract: 'Extracting text',
  chunk: 'Chunking (800 tokens)', embed: 'Embedding (768d)', screen: 'Screening novelty (85%)',
  index: 'Indexing vectors', done: 'Indexed', error: 'Failed', cancelled: 'Cancelled',
}

/** Human label for a worker stage key; falls back to the raw key. */
export function stageLabel(stage) {
  return STAGE_LABELS[stage] ?? (stage || '')
}

/** Mean progress across accepted rows, so the batch has one headline bar. */
export function batchProgress(rows) {
  const accepted = rows.filter((row) => row.jobId)
  if (accepted.length === 0) return 0
  const total = accepted.reduce((sum, row) => sum + Math.min(100, Math.max(0, row.job?.progress ?? 0)), 0)
  return Math.round(total / accepted.length)
}

/**
 * Rows that carry a job, reduced to what a refreshed page can still show.
 *
 * Stamped with the account that queued them. sessionStorage is per tab but is
 * NOT cleared by signing out, and the restore below runs on mount with no idea
 * who is signed in, so one reader's manuscript filenames and titles were
 * restored into the next reader's table when two people used the same tab in
 * turn. The job ids themselves are owner-scoped server-side and simply 404, but
 * the titles had already rendered. Audited 2026-09-12.
 */
export function serializeActiveBatch(rows, ownerId) {
  return JSON.stringify({
    ownerId: ownerId ?? null,
    rows: rows.filter((row) => row.jobId).map((row) => ({
      id: row.id, name: row.name, size: row.size, title: row.title,
      idempotencyKey: row.idempotencyKey, jobId: row.jobId,
    })),
  })
}

export function restoreActiveBatch(json, ownerId) {
  if (!json || !ownerId) return null
  try {
    const stored = JSON.parse(json)
    // A bare array is the pre-2026-09-12 shape, which recorded no owner. There
    // is no way to tell whose manuscripts those are, so they are discarded
    // rather than shown to whoever happens to be signed in now.
    if (!stored || Array.isArray(stored) || stored.ownerId !== ownerId) return null
    const entries = stored.rows
    if (!Array.isArray(entries) || entries.length === 0) return null
    return entries
      .filter((entry) => entry && typeof entry.jobId === 'string' && typeof entry.id === 'string')
      .map((entry) => ({
        ...createBatchRow({ name: entry.name ?? 'manuscript.pdf', size: entry.size ?? 0 }, {
          id: entry.id, idempotencyKey: entry.idempotencyKey,
        }),
        file: null,
        title: entry.title ?? '',
        extracted: true,
        jobId: entry.jobId,
        job: { status: 'queued', stage: 'download', progress: 8, message: 'Restoring durable upload status…' },
      }))
  } catch {
    return null
  }
}
