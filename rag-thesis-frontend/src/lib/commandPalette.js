/**
 * Keyboard movement for the Ctrl/Cmd+K quick-access list.
 *
 * Arrow keys wrap, Home/End jump, and an out-of-range current index (the list
 * just shrank under a new query) is clamped first. Returns -1 for an empty
 * list so the caller has nothing to run.
 */
export function nextCommandIndex(key, current, count) {
  if (count <= 0) return -1
  const index = current < 0 ? 0 : Math.min(current, count - 1)
  if (key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowUp') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return index
}
