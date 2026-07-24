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
