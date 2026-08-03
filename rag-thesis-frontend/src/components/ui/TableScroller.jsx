import { cn } from '../../lib/utils'

/**
 * Horizontally scrollable wrapper for a wide table.
 *
 * A bare `overflow-x-auto` div scrolls with a mouse or trackpad but cannot be
 * reached with a keyboard, which strands the off-screen columns on narrow
 * viewports. `tabIndex={0}` puts the region in the tab order and `role="region"`
 * plus a name explain what it is once focus lands there — both are required for
 * the name to be exposed at all.
 */
export function TableScroller({ label, className, children }) {
  return (
    <div
      className={cn('overflow-x-auto', className)}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  )
}
