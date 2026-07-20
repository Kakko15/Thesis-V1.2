export const UPLOAD_STEPS = Object.freeze({ manuscript: 0, metadata: 1, review: 2, ingesting: 3 })

export function emptyUploadForm(department = 'CCSICT') {
  return { title: '', authors: '', year: '', abstract: '', track: '', department }
}

export function createUploadState(department = 'CCSICT') {
  return {
    step: UPLOAD_STEPS.manuscript,
    file: null,
    form: emptyUploadForm(department),
    errors: {},
    job: null,
    submitting: false,
    parsing: false,
    pendingFile: null,
    pollError: '',
  }
}

export function uploadReducer(state, action) {
  switch (action.type) {
    case 'set-step': return { ...state, step: action.step }
    case 'set-file': return { ...state, file: action.file }
    case 'set-pending-file': return { ...state, pendingFile: action.file }
    case 'set-field': return { ...state, form: { ...state.form, [action.key]: action.value } }
    case 'set-form': return { ...state, form: typeof action.value === 'function' ? action.value(state.form) : action.value }
    case 'set-errors': return { ...state, errors: action.errors }
    case 'set-job': return { ...state, job: action.job }
    case 'set-submitting': return { ...state, submitting: action.value }
    case 'set-parsing': return { ...state, parsing: action.value }
    case 'set-poll-error': return { ...state, pollError: action.value }
    case 'reset': return createUploadState(action.department)
    default: return state
  }
}

export function isCurrentPoll({ mounted, generation, currentGeneration, jobId, currentJobId }) {
  return Boolean(mounted && generation === currentGeneration && jobId === currentJobId)
}
