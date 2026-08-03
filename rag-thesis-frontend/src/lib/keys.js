/**
 * Stable React keys for lists that carry no natural identifier.
 *
 * Using the array index makes React tie component state to a position rather
 * than to an item, so state is misapplied when a list is truncated, filtered
 * or re-ordered. These helpers derive keys that stay with the item instead.
 */

/**
 * Keys derived from each value's own content. Repeated values are
 * disambiguated by occurrence number, so keys remain unique while still
 * following an item when its position changes.
 */
export function contentKeys(values, prefix = 'item') {
  const seen = new Map()
  return values.map((value) => {
    const base = typeof value === 'string' ? value : JSON.stringify(value)
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)
    return `${prefix}:${base}#${occurrence}`
  })
}

/**
 * Keys for fixed-length placeholder rows — loading skeletons, one-time-code
 * boxes, decorative particles. These lists never re-order or change length
 * during a render pass, so the slot itself is the stable identity; this just
 * gives each slot a durable name instead of a positional index.
 */
export function slotKeys(count, prefix) {
  return Array.from({ length: count }, (_, position) => `${prefix}-slot-${position}`)
}
