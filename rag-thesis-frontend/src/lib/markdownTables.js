/**
 * GitHub-style Markdown tables, split out of model-written Markdown.
 *
 * react-markdown renders CommonMark only, so a table in a novelty write-up or
 * a chat answer reached the reader as rows of pipes and dashes (2026-11-25
 * user testing). remark-gfm would fix that at the cost of a new dependency and
 * GFM's other extensions (autolinks, raw-HTML-adjacent syntax) applied to
 * untrusted text. Only the table shape is needed, so only tables are parsed:
 * `SafeMarkdown` renders each table segment as a real table, and every other
 * segment, including each cell, still goes through the same safe renderer.
 */

const DIVIDER_CELL = /^:?-{3,}:?$/

/** Cells of one table row. A `\|` stays a literal pipe inside a cell. */
export function splitTableRow(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'))
}

function isTableRow(line) {
  return line.includes('|') && line.trim() !== ''
}

function isDividerFor(line, columns) {
  if (!isTableRow(line)) return false
  const cells = splitTableRow(line)
  return cells.length === columns && cells.every((cell) => DIVIDER_CELL.test(cell))
}

/**
 * `markdown` as ordered segments: `{ type: 'markdown', text }` and
 * `{ type: 'table', header, rows }`. Fenced code is never read as a table.
 */
export function splitMarkdownTables(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const segments = []
  let buffer = []
  let inFence = false
  const flush = () => {
    if (buffer.length) segments.push({ type: 'markdown', text: buffer.join('\n') })
    buffer = []
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim().startsWith('```')) inFence = !inFence
    const header = !inFence && isTableRow(line) ? splitTableRow(line) : null
    if (header && index + 1 < lines.length && isDividerFor(lines[index + 1], header.length)) {
      const rows = []
      let next = index + 2
      while (next < lines.length && isTableRow(lines[next])) {
        const cells = splitTableRow(lines[next])
        rows.push(header.map((_, column) => cells[column] ?? ''))
        next += 1
      }
      flush()
      segments.push({ type: 'table', header, rows })
      index = next
    } else {
      buffer.push(line)
      index += 1
    }
  }
  flush()
  return segments
}
