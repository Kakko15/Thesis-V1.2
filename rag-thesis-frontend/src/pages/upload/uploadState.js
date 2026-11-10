import { ABSTRACT_MODES, emptyAbstractVariants } from './abstractMode.js'

export const UPLOAD_STEPS = Object.freeze({ manuscript: 0, metadata: 1, review: 2, ingesting: 3 })

export function emptyUploadForm(department = 'CCSICT') {
  return {
    title: '', authors: '', adviser: '', panel_chair: '', panel_members: '',
    year: '', abstract: '', track: '', department,
    program_id: '', specialization_id: '', requires_specialization: false,
    thesis_category: 'student',
  }
}

export function createUploadState(department = 'CCSICT') {
  return {
    step: UPLOAD_STEPS.manuscript,
    // Which way the wizard last moved. The step surfaces slide along this axis,
    // so Back reverses the transition instead of replaying the forward one.
    direction: 1,
    file: null,
    form: emptyUploadForm(department),
    errors: {},
    // Keys the title-page extractor filled, for the "Autofilled" provenance
    // chips. Cleared per key on first edit so a chip never outlives its claim.
    autofilled: {},
    // Why a blank field was not filled by the most recent extraction. Kept
    // separately from validation: this is guidance, not an invalid-value
    // error, and it is only shown while the corresponding control is empty.
    autofillNotes: {},
    job: null,
    submitting: false,
    parsing: false,
    pendingFile: null,
    pollError: '',
    // Which abstract the wizard is showing, and both texts it knows for this
    // manuscript. The extended one is fetched at most once per file, so the
    // control can be flipped back and forth for the price of one generation.
    abstractMode: ABSTRACT_MODES.document,
    abstractVariants: emptyAbstractVariants(),
    extendingAbstract: false,
  }
}

function withoutAutofilled(autofilled, key) {
  if (!autofilled[key]) return autofilled
  const next = { ...autofilled }
  delete next[key]
  return next
}

/**
 * Drop every claim whose value the patch actually changed.
 *
 * `set-field` clears one key because it is given one key. `set-form` replaces
 * whole slices of the form -- picking a program rewrites four fields at once --
 * so it has to compare instead. Without this the Selects could carry no
 * provenance marker at all: a chip left on `department` after a superadmin
 * chose a different one credits the extractor with a value it never produced,
 * and a marker that lies is worse than none.
 *
 * Returns the same object by identity when nothing claimed changed, so the
 * chips do not re-render on every keystroke.
 */
function withoutChangedClaims(autofilled, before, after) {
  const stale = Object.keys(autofilled).filter((key) => before[key] !== after[key])
  if (stale.length === 0) return autofilled
  const next = { ...autofilled }
  for (const key of stale) delete next[key]
  return next
}

export function uploadReducer(state, action) {
  switch (action.type) {
    case 'set-step': return {
      ...state,
      step: action.step,
      direction: action.step < state.step ? -1 : 1,
    }
    // A new manuscript is a new pair of abstracts, and the control returns to
    // the default: an extended abstract costs a generation, so carrying the
    // setting over would spend one on a file nobody asked it for.
    case 'set-file': return {
      ...state,
      file: action.file,
      abstractMode: ABSTRACT_MODES.document,
      abstractVariants: emptyAbstractVariants(),
      extendingAbstract: false,
    }
    case 'set-pending-file': return { ...state, pendingFile: action.file }
    case 'set-autofilled': return {
      ...state,
      autofilled: Object.fromEntries((action.keys ?? []).map((key) => [key, true])),
      autofillNotes: action.notes ?? {},
    }
    case 'set-field': return {
      ...state,
      form: { ...state.form, [action.key]: action.value },
      autofilled: withoutAutofilled(state.autofilled, action.key),
    }
    case 'set-form': {
      const form = typeof action.value === 'function' ? action.value(state.form) : action.value
      return { ...state, form, autofilled: withoutChangedClaims(state.autofilled, state.form, form) }
    }
    case 'set-errors': return { ...state, errors: action.errors }
    case 'set-job': return { ...state, job: action.job }
    case 'set-submitting': return { ...state, submitting: action.value }
    case 'set-parsing': return { ...state, parsing: action.value }
    case 'set-extending-abstract': return { ...state, extendingAbstract: action.value }
    // The result of `switchAbstractMode` or `receivedAbstract`, applied whole.
    // The claim follows the value: the abstract in the field is machine-made
    // either way -- read off the page or written by a model -- and an empty
    // field is claimed by nobody.
    case 'apply-abstract': {
      const abstract = action.abstract || ''
      const autofilled = abstract
        ? { ...state.autofilled, abstract: true }
        : withoutAutofilled(state.autofilled, 'abstract')
      return {
        ...state,
        abstractMode: action.mode,
        abstractVariants: action.variants,
        form: { ...state.form, abstract },
        autofilled,
      }
    }
    case 'set-poll-error': return { ...state, pollError: action.value }
    case 'reset': return createUploadState(action.department)
    default: return state
  }
}

export function isCurrentPoll({ mounted, generation, currentGeneration, jobId, currentJobId }) {
  return Boolean(mounted && generation === currentGeneration && jobId === currentJobId)
}

/**
 * Metadata rules shared by the single-file wizard and every row of a batch.
 * `form` carries the title/authors/year of one manuscript plus the shared
 * classification (thesis_category, program_id, specialization_id,
 * requires_specialization, department).
 */
export function uploadMetadataErrors(form) {
  const errors = {}
  if ((form.title ?? '').trim().length < 5) errors.title = 'Enter the full thesis title'
  // The program requirement follows the manuscript: student theses always
  // belong to a program, faculty research may sit outside the catalog.
  if (form.thesis_category !== 'faculty' && !form.program_id) {
    errors.program_id = 'Select the academic program'
  }
  if (form.program_id && form.requires_specialization && !form.specialization_id) {
    errors.specialization_id = 'Select the program specialization'
  }
  if (!form.department) errors.department = 'Select the department'
  const latestYear = new Date().getFullYear() + 1
  if (form.year && (!/^\d{4}$/.test(form.year) || +form.year < 1978 || +form.year > latestYear)) {
    errors.year = 'Enter a valid year'
  }
  return errors
}

/**
 * Per-field blur validation (matching the sign-in / sign-up field behavior):
 * clicking into any metadata field and leaving it empty or invalid surfaces an
 * inline error message for that specific field, and clears it as soon as a
 * valid value is entered.
 */
const REQUIRED_FIELD_MESSAGES = Object.freeze({
  authors: 'Please enter the author name(s)',
  adviser: 'Please enter the thesis adviser',
  panel_chair: 'Please enter the panel chair',
  panel_members: 'Please enter the panel members',
  abstract: 'Please enter the thesis abstract',
})

function yearFieldError(rawYear) {
  const latestYear = new Date().getFullYear() + 1
  const val = String(rawYear ?? '').trim()
  if (!val) return 'Please enter the completion year'
  if (!/^\d{4}$/.test(val) || +val < 1978 || +val > latestYear) {
    return `Enter a valid 4-digit year (1978–${latestYear})`
  }
  return ''
}

export function uploadFieldError(key, form = {}) {
  if (key in REQUIRED_FIELD_MESSAGES) {
    return String(form[key] ?? '').trim() ? '' : REQUIRED_FIELD_MESSAGES[key]
  }
  if (key === 'title') {
    const val = String(form.title ?? '').trim()
    if (!val) return 'Please enter the thesis title'
    return val.length < 5 ? 'Enter the full thesis title (at least 5 characters)' : ''
  }
  if (key === 'year') return yearFieldError(form.year)
  if (key === 'department') return form.department ? '' : 'Select the department'
  if (key === 'program_id') {
    return form.thesis_category !== 'faculty' && !form.program_id ? 'Select the academic program' : ''
  }
  if (key === 'specialization_id') {
    return form.program_id && form.requires_specialization && !form.specialization_id
      ? 'Select the program specialization'
      : ''
  }
  return ''
}

export const REQUIRED_UPLOAD_KEYS = Object.freeze([
  'title', 'authors', 'year', 'adviser', 'panel_chair', 'panel_members',
  'department', 'program_id', 'specialization_id', 'abstract',
])

export function uploadRequiredErrors(form = {}) {
  const errors = {}
  for (const key of REQUIRED_UPLOAD_KEYS) {
    const message = uploadFieldError(key, form)
    if (message) errors[key] = message
  }
  return errors
}
