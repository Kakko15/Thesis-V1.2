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
