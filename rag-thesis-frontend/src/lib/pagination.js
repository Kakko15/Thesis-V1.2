/**
 * Pagination calculations and sliding window algorithms for Google-like UI/UX pagination.
 */

/**
 * Calculates the total number of pages given total items and page size limit.
 * Always returns at least 1 page.
 */
export function totalPageCount(total, limit) {
  const safeLimit = Math.max(1, Math.floor(Number(limit)) || 1)
  const safeTotal = Math.max(0, Math.floor(Number(total)) || 0)
  return Math.max(1, Math.ceil(safeTotal / safeLimit))
}

/**
 * Clamps a page number between 1 and the total pages.
 */
export function clampPage(page, totalPages) {
  const safeTotal = Math.max(1, Math.floor(Number(totalPages)) || 1)
  const safePage = Math.floor(Number(page)) || 1
  return Math.min(Math.max(1, safePage), safeTotal)
}

/**
 * Returns an array representing the pagination sequence with numbers and ellipsis markers.
 * Mirrors the Google pagination sliding window pattern:
 * - When total pages <= 7: shows all pages (e.g. [1, 2, 3, 4, 5])
 * - When near start (page <= 4): [1, 2, 3, 4, 5, '...', totalPages]
 * - When near end (page >= totalPages - 3): [1, '...', totalPages - 4, ..., totalPages]
 * - When in middle: [1, '...', page - 1, page, page + 1, '...', totalPages]
 */
export function getPaginationPages(currentPage, totalPages, maxVisible = 7) {
  const safeTotal = Math.floor(Number(totalPages)) || 0
  if (safeTotal <= 0) return []
  if (safeTotal === 1) return [1]

  const safeCurrent = clampPage(currentPage, safeTotal)
  const limit = Math.max(5, Math.floor(Number(maxVisible)) || 7)

  if (safeTotal <= limit) {
    return Array.from({ length: safeTotal }, (_, i) => i + 1)
  }

  // Near the start
  if (safeCurrent <= 4) {
    return [1, 2, 3, 4, 5, '...', safeTotal]
  }

  // Near the end
  if (safeCurrent >= safeTotal - 3) {
    return [
      1,
      '...',
      safeTotal - 4,
      safeTotal - 3,
      safeTotal - 2,
      safeTotal - 1,
      safeTotal,
    ]
  }

  // In the middle
  return [1, '...', safeCurrent - 1, safeCurrent, safeCurrent + 1, '...', safeTotal]
}

/**
 * Slices an array of items for the given page and limit.
 */
export function paginateItems(items, page, limit) {
  if (!Array.isArray(items)) return []
  const safeLimit = Math.max(1, Math.floor(Number(limit)) || 1)
  const totalPages = totalPageCount(items.length, safeLimit)
  const safePage = clampPage(page, totalPages)
  const startIndex = (safePage - 1) * safeLimit
  return items.slice(startIndex, startIndex + safeLimit)
}
