/**
 * Presentation logic for the single-manuscript upload wizard.
 *
 * Deliberately import-free apart from the step enum: the unit runner cannot
 * load JSX, and keeping icons out of this module means every rule below is
 * directly testable. `Upload.jsx` and the `components/upload/*` surfaces hold
 * only markup and call into here for the decisions.
 */
import { UPLOAD_STEPS } from './uploadState.js'

export const WIZARD_STEPS = Object.freeze([
  Object.freeze({ key: 'manuscript', label: 'Manuscript', hint: 'Choose the PDF' }),
  Object.freeze({ key: 'metadata', label: 'Metadata', hint: 'Describe the thesis' }),
  Object.freeze({ key: 'review', label: 'Review', hint: 'Confirm and ingest' }),
])

/** The seven durable-worker stages, in the order the worker reports them. */
export const PIPELINE_STAGES = Object.freeze([
  Object.freeze({ key: 'download', label: 'Secure source' }),
  Object.freeze({ key: 'malware_scan', label: 'Malware scan' }),
  Object.freeze({ key: 'extract', label: 'Extract & clean' }),
  Object.freeze({ key: 'chunk', label: 'Chunk (800 tokens)' }),
  Object.freeze({ key: 'embed', label: 'Embed (768d)' }),
  Object.freeze({ key: 'screen', label: 'Screen novelty (85%)' }),
  Object.freeze({ key: 'index', label: 'Index vectors' }),
])

// The backend reports a `store` stage while the manuscript is being staged
// privately, which is not one of the seven worker stages. findIndex returned -1
// for it, so the whole stepper rendered inert and greyed while the progress bar
// already showed movement. Map it onto the first worker stage, and treat the
// pre-worker statuses as in-flight so the step reads as "starting".
const STAGE_ALIASES = { store: 'download', queued: 'download', '': 'download' }
const IN_FLIGHT_STATUSES = ['staging', 'queued', 'processing', 'retry_wait']

/** Job progress as a whole number of percent, safe against nulls and junk. */
export function clampPercent(value) {
  const percent = Number(value ?? 0)
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * Resolve one status poll into everything the timeline needs to paint.
 * A completed job marks every stage done regardless of the last stage seen,
 * because the terminal poll does not always carry `index`.
 */
export function stageView(job) {
  const status = job?.status ?? ''
  const reported = job?.stage ?? ''
  const key = STAGE_ALIASES[reported] ?? reported
  const index = PIPELINE_STAGES.findIndex((stage) => stage.key === key)
  const completed = status === 'completed'
  const inFlight = IN_FLIGHT_STATUSES.includes(status)
  return {
    index,
    progress: completed ? 100 : clampPercent(job?.progress),
    stages: PIPELINE_STAGES.map((stage, position) => ({
      key: stage.key,
      label: stage.label,
      done: completed || position < index,
      active: !completed && position === index && inFlight,
    })),
  }
}

/**
 * How one rail node behaves.
 *
 * Only 'done' may render as a <button>. Playwright matches accessible names as
 * case-insensitive substrings and no upload assertion passes `exact: true`, so
 * a rail node named "Review" that is focusable at the same time as step 2's
 * footer "Review" button is a strict-mode violation. A node is only ever 'done'
 * once the wizard has moved past it, and by then that footer button is gone.
 */
export function stepInteraction(index, current) {
  if (index < current) return 'done'
  if (index === current) return 'current'
  return 'upcoming'
}

const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled']

/** Whether the durable job has stopped for good, one way or another. */
export function isTerminalJob(job) {
  return TERMINAL_JOB_STATUSES.includes(job?.status)
}

/**
 * What the sticky rail shows.
 *
 * 'summary' — the live record, while the manuscript is being chosen and described.
 * 'steps'   — progress only. The review panel beside it already prints the same
 *             title, category, department and file, and two copies is both a
 *             duplicate-content design smell and a `getByText` strict-mode
 *             violation for the E2E assertions on 'Deterministic E2E Thesis'
 *             and 'Student Thesis'.
 * 'progress'— the ring, while the worker is running.
 * 'hidden'  — once the job is over. A progress ring next to "Thesis indexed!"
 *             says nothing, and the outcome reads better across the full card.
 */
export function railMode(step, job) {
  if (isTerminalJob(job)) return 'hidden'
  if (step >= UPLOAD_STEPS.ingesting) return 'progress'
  if (step === UPLOAD_STEPS.review) return 'steps'
  return 'summary'
}

function displayValue(value) {
  if (value == null) return ''
  return String(value).trim()
}

/**
 * The rail's live manuscript summary. Rows that are still empty are dropped
 * rather than rendered as em dashes, so the list grows as the form is filled
 * and never shows a column of placeholders.
 */
export function summaryRows(form = {}, context = {}) {
  const { program, specialization, categoryLabel } = context
  return [
    { key: 'title', label: 'Title', value: displayValue(form.title), tone: null },
    { key: 'authors', label: 'Authors', value: displayValue(form.authors), tone: null },
    { key: 'year', label: 'Year', value: displayValue(form.year), tone: null },
    { key: 'category', label: 'Category', value: displayValue(categoryLabel), tone: 'forest' },
    { key: 'program', label: 'Program', value: displayValue(program?.code), tone: 'forest' },
    { key: 'specialization', label: 'Specialization', value: displayValue(specialization?.code), tone: 'gold' },
    { key: 'department', label: 'Department', value: displayValue(form.department), tone: 'neutral' },
  ].filter((row) => row.value !== '')
}

/** Human file size. Below a megabyte the MB reading rounds to 0.00 and reads as empty. */
export function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '0 KB'
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Split "what the title page named" from "what the form will hold".
 *
 * These are not the same department, and conflating them is what put a
 * permanent "Autofilled" chip on the superadmin's department Select: the form
 * is seeded with a department, so a fallback to its current value is never
 * blank, and crediting that fallback claimed a value the extractor had never
 * produced (2026-09-09).
 *
 * - `extractedDepartment` is what the page actually named, and the only value
 *   `autofilledKeys` may be given. Blank for everyone but a superadmin, whose
 *   department is the only one not pinned by the server.
 * - `department` is what the form ends up holding, and what the program code is
 *   resolved inside, so it always falls back to a real college.
 */
export function extractionDepartment({
  isSuperadmin = false, extracted = '', current = '', enforced = '',
} = {}) {
  const extractedDepartment = isSuperadmin ? displayValue(extracted) : ''
  return {
    extractedDepartment,
    department: extractedDepartment || (isSuperadmin ? current : enforced),
  }
}

/**
 * Which metadata keys the title-page extractor is allowed to claim it filled.
 *
 * `program_id` rather than the `program_code` the API returns: the caller
 * resolves the code against the department it selected before it can fill
 * anything, so the id is what the form ends up holding, and a code that
 * resolved to nothing must not be credited to the extractor.
 */
export const AUTOFILLABLE_KEYS = Object.freeze([
  'title', 'authors', 'year', 'department', 'program_id',
])

/**
 * The subset of AUTOFILLABLE_KEYS that `patch` actually supplied a value for.
 * Drives the "Autofilled" provenance chips, so a field the extractor left
 * alone is never credited to it.
 */
export function autofilledKeys(patch = {}) {
  return AUTOFILLABLE_KEYS.filter((key) => displayValue(patch?.[key]) !== '')
}
