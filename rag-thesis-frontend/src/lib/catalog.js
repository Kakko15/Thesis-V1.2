// Authorship provenance of a manuscript. Deliberately unrelated to the
// 'faculty' user role: the category classifies the thesis, not the uploader.
export const THESIS_CATEGORIES = Object.freeze([
  Object.freeze({ value: 'student', label: 'Student Thesis' }),
  Object.freeze({ value: 'faculty', label: 'Faculty Research' }),
])

export function thesisCategoryLabel(value) {
  const category = THESIS_CATEGORIES.find((item) => item.value === value)
  return category ? category.label : 'Student Thesis'
}

export function isFacultyThesis(paper) {
  return paper?.thesis_category === 'faculty'
}

export function normalizeDepartments(payload) {
  const departments = Array.isArray(payload)
    ? payload
    : payload?.departments

  if (!Array.isArray(departments)) return []

  return departments.filter((department) => (
    department !== null
    && typeof department === 'object'
    && !Array.isArray(department)
  ))
}

/** The programs of one department, or an empty list when it is unknown. */
export function departmentPrograms(departments, departmentName) {
  if (!departmentName) return []
  const department = (departments || []).find((entry) => entry?.name === departmentName)
  return department?.programs || []
}

/**
 * The classification patch for one program, with its specialization.
 *
 * Both upload forms derived this inline in their `onChange` handlers, and the
 * title-page extractor now produces the same selection from a PDF, so all three
 * read the rules from here instead of restating them:
 *
 * - `track` is the specialization's name, or the program's code when the
 *   program takes no specialization. That is what
 *   `services/catalog.py::resolve_academic_selection` stamps into `papers.track`.
 * - `requires_specialization` is simply whether the program offers any; the
 *   backend enforces it for BSCS and BSIT.
 *
 * Lookup is by code rather than id because the extractor returns codes: an id
 * would have to be trusted, while a code is resolved inside the department the
 * form has actually selected, so a program from another college resolves to
 * nothing rather than to a value the upload would be rejected for.
 *
 * Returns `null` when the department or the program code is unknown, which the
 * callers treat as "nothing to autofill".
 */
export function programSelection(departments, departmentName, programCode, specializationCode) {
  if (!programCode) return null
  const programs = departmentPrograms(departments, departmentName)
  const program = programs.find((item) => item.code === programCode)
  if (!program) return null
  const specializations = program.specializations || []
  const specialization = specializationCode
    ? specializations.find((item) => item.code === specializationCode)
    : undefined
  return {
    program_id: program.id,
    specialization_id: specialization?.id || '',
    requires_specialization: specializations.length > 0,
    track: specialization ? specialization.name : (specializations.length ? '' : program.code || ''),
  }
}

/** The same patch for a program chosen by id in a form or the bulk bar. */
export function programSelectionById(programs, programId) {
  const program = (programs || []).find((item) => item.id === programId)
  const specializations = program?.specializations || []
  return {
    program_id: programId,
    specialization_id: '',
    requires_specialization: specializations.length > 0,
    track: specializations.length ? '' : (program?.code || ''),
  }
}

/** The patch for choosing a specialization inside an already-chosen program. */
export function specializationSelection(specializations, specializationId) {
  const specialization = (specializations || []).find((item) => item.id === specializationId)
  return { specialization_id: specializationId, track: specialization?.name || '' }
}
