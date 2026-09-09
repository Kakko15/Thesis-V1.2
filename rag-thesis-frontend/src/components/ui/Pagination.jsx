import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clampPage, getPaginationPages, totalPageCount } from '../../lib/pagination.js'
import { cn } from '../../lib/utils'

/**
 * Capsule/pill pagination component matching DailyUI Challenge #085
 * and styled to align with the ISU Material 3 You design system.
 */
export function Pagination({
  page = 1,
  setPage,
  total = 0,
  limit = 5,
  showJump,
  hideOnSinglePage = true,
  className,
}) {
  const [jumpInput, setJumpInput] = useState('')
  const totalPages = totalPageCount(total, limit)
  const currentPage = clampPage(page, totalPages)
  const pages = getPaginationPages(currentPage, totalPages)

  // Auto-enable jump input only when there are enough pages to warrant jumping (> 7)
  const enableJump = showJump !== undefined ? showJump : totalPages > 7

  if (hideOnSinglePage && totalPages <= 1) {
    return null
  }

  const changePage = (targetPage) => {
    const safeTarget = clampPage(targetPage, totalPages)
    if (safeTarget === currentPage) return

    // Preserve the user's scroll position across page switches
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0
    const scrollX = typeof window !== 'undefined' ? window.scrollX : 0

    setPage(safeTarget)

    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' })
      })
      setTimeout(() => {
        window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' })
      }, 0)
    }
  }

  const handleJumpSubmit = (e) => {
    e.preventDefault()
    const targetPage = Number.parseInt(jumpInput, 10)
    if (!Number.isNaN(targetPage)) {
      changePage(targetPage)
      setJumpInput('')
    }
  }

  return (
    <div className={cn('flex shrink-0 flex-wrap items-center gap-2 [overflow-anchor:none]', className)}>
      <nav
        aria-label="Pagination Navigation"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-forest-900/10 bg-forest-900/[0.04] p-1 shadow-2xs dark:border-white/10 dark:bg-white/[0.04] [overflow-anchor:none]"
      >
        {/* Previous page button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            changePage(currentPage - 1)
          }}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-forest-900/10 hover:text-ink disabled:pointer-events-none disabled:opacity-25 dark:hover:bg-white/10"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Numbered page items and ellipses */}
        {pages.map((item, index) => {
          if (item === '...') {
            return (
              <span
                key={`ellipsis-${index < 3 ? 'start' : 'end'}`}
                aria-hidden="true"
                className="flex h-8 w-6 shrink-0 select-none items-center justify-center text-xs font-semibold tracking-widest text-ink-faint"
              >
                ...
              </span>
            )
          }

          const isCurrent = item === currentPage
          return (
            <button
              key={item}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                changePage(item)
              }}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={isCurrent ? `Current page, page ${item}` : `Go to page ${item}`}
              className={cn(
                'flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-xs transition-all',
                isCurrent
                  ? 'bg-forest-800 font-bold text-white shadow-2xs dark:bg-forest-400 dark:text-forest-950'
                  : 'font-semibold text-ink-muted hover:bg-forest-900/10 hover:text-ink dark:hover:bg-white/10',
              )}
            >
              {item}
            </button>
          )
        })}

        {/* Next page button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            changePage(currentPage + 1)
          }}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-forest-900/10 hover:text-ink disabled:pointer-events-none disabled:opacity-25 dark:hover:bg-white/10"
        >
          <ChevronRight size={16} />
        </button>
      </nav>

      {/* "Go to page [ n ] >" jump container from reference design */}
      {enableJump && totalPages > 1 && (
        <form
          onSubmit={handleJumpSubmit}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-forest-900/10 bg-forest-900/[0.04] px-2.5 py-1 text-xs dark:border-white/10 dark:bg-white/[0.04]"
        >
          <label htmlFor="jump-to-page-input" className="select-none text-ink-muted">
            Go to page
          </label>
          <input
            id="jump-to-page-input"
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder={String(currentPage)}
            aria-label="Page number to jump to"
            className="h-6 w-11 rounded-md border border-forest-900/15 bg-white/80 px-1 text-center font-mono text-xs font-semibold text-ink shadow-2xs outline-none focus:border-forest-600 focus:ring-1 focus:ring-forest-600 dark:border-white/15 dark:bg-forest-950/70 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="submit"
            aria-label="Submit page jump"
            disabled={!jumpInput}
            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-forest-900/10 hover:text-ink disabled:opacity-30 dark:hover:bg-white/10"
          >
            <ChevronRight size={14} />
          </button>
        </form>
      )}
    </div>
  )
}

/**
 * Standard card footer container that lays out the "Showing X to Y of Z" range
 * and the Pagination capsule on opposite sides.
 */
export function PaginationFooter({
  page = 1,
  setPage,
  total = 0,
  limit = 5,
  showJump,
  className,
}) {
  const totalPages = totalPageCount(total, limit)
  if (total <= limit) return null

  const safePage = clampPage(page, totalPages)
  const start = (safePage - 1) * limit + 1
  const end = Math.min(safePage * limit, total)

  return (
    <div
      className={cn(
        'mt-auto flex min-h-[3.5rem] flex-col items-center justify-between gap-3 border-t border-forest-900/10 px-5 py-3 sm:flex-row dark:border-white/10',
        className,
      )}
    >
      <div className="text-xs text-ink-muted">
        Showing <span className="font-semibold text-ink">{start}</span> to{' '}
        <span className="font-semibold text-ink">{end}</span> of{' '}
        <span className="font-semibold text-ink">{total}</span>
      </div>
      <Pagination
        page={safePage}
        setPage={setPage}
        total={total}
        limit={limit}
        showJump={showJump}
      />
    </div>
  )
}

// Aliases for compatibility
export { Pagination as GooglePagination, PaginationFooter as GooglePaginationFooter }
