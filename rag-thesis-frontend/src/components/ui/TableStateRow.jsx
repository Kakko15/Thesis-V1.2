import { AlertTriangle } from 'lucide-react'

import { Button } from './Button'

/**
 * The one row a data table shows when it has no rows to show.
 *
 * Every admin table used to hand-roll a `loading ? … : empty ? … : rows` pair
 * and omit the third case entirely, so a failed fetch rendered as "No users
 * found." — indistinguishable from a genuinely empty result, with nothing to
 * retry. Separating the three states matters most on exactly these surfaces: an
 * administrator deciding whether the archive is empty or the connection is
 * broken cannot tell from an empty table.
 *
 * Returns `null` when there is real data to render, so a call site can place it
 * directly above its row map.
 *
 * @param {number} colSpan       Columns to span; must match the table header.
 * @param {boolean} loading      Query is in flight and has no data yet.
 * @param {unknown} error        Truthy when the fetch failed.
 * @param {boolean} empty        Fetch succeeded and returned nothing.
 * @param {() => void} [onRetry] Refetch; a Retry button appears when supplied.
 * @param {string} [loadingLabel]
 * @param {string} [emptyLabel]
 * @param {string} [errorLabel]
 */
export function TableStateRow({
  colSpan,
  loading = false,
  error = null,
  empty = false,
  onRetry,
  loadingLabel = 'Loading…',
  emptyLabel = 'Nothing to show yet.',
  errorLabel = 'This data could not be loaded.',
}) {
  // Error outranks empty: a failed fetch usually also looks empty, and reporting
  // it as empty is the misreading this component exists to prevent.
  if (error) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-6 py-8 text-center">
          <div className="flex flex-col items-center gap-3 text-sm">
            <span className="flex items-center gap-2 text-ink-muted">
              <AlertTriangle size={16} className="shrink-0 text-flame-500" aria-hidden="true" />
              {errorLabel}
            </span>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
            )}
          </div>
        </td>
      </tr>
    )
  }
  if (loading) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-6 py-8 text-center text-ink-faint">
          {loadingLabel}
        </td>
      </tr>
    )
  }
  if (empty) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-6 py-8 text-center text-ink-faint">
          {emptyLabel}
        </td>
      </tr>
    )
  }
  return null
}
