import { verdictLabel } from '../../lib/utils.js'

/**
 * Display helpers for a novelty report's Explanation, Ask and Matches tabs.
 *
 * Kept out of ScanReport.jsx so they can be asserted directly, like the other
 * `pages/novelty/*.js` helpers.
 */

const RAW_LEVEL = /`?\b(exact_duplicate|high_overlap|review_suggested)\b`?/g
// `[1]`, `[2, 3]` -- but not a Markdown link's `[text](url)`.
const CITATION_MARKER = / ?\[\d+(?:,\s?\d+)*\](?!\()/g

/**
 * Model-written report text as a reviewer should read it.
 *
 * User testing on 2026-11-25 found the write-up showing the internal enum
 * `high_overlap` and `[1]` markers that point at no reference list. Scans
 * stored before the prompt was fixed still carry both, so they are cleaned
 * at display time rather than by rewriting history.
 */
export function readableReportText(markdown) {
  return String(markdown ?? '')
    .replace(RAW_LEVEL, (_match, level) => verdictLabel(level))
    .replaceAll('`clear`', 'Clear')
    .replace(CITATION_MARKER, '')
}

/** "p. 3", "pp. 3–4", or '' when the page is unknown. */
export function pageLabel(start, end) {
  const first = Number(start)
  const last = Number(end)
  if (!Number.isFinite(first) || first <= 0) return ''
  if (!Number.isFinite(last) || last <= first) return `p. ${first}`
  return `pp. ${first}–${last}`
}

/**
 * The Matches tab's passage rows, strongest first.
 *
 * Each pairs the reviewer's own manuscript text with the archived thesis's
 * citation metadata. The archived passage itself is never served (the
 * indirect-access model), so there is nothing else to show. Scans stored
 * before `matched_passages` existed have none, which reads as an empty list.
 */
export function passageRows(scan) {
  const passages = Array.isArray(scan?.matched_passages) ? scan.matched_passages : []
  return passages
    .filter((passage) => passage && typeof passage === 'object' && passage.excerpt)
    .map((passage) => {
      const archivedPages = pageLabel(passage.archived_page_start, passage.archived_page_end)
      return {
        title: passage.title || 'Archived thesis',
        year: passage.year || null,
        similarity: Number(passage.similarity) || 0,
        excerpt: passage.excerpt,
        yourWhere: passage.section
          || pageLabel(passage.uploaded_page_start, passage.uploaded_page_end)
          || 'Your manuscript',
        archivedWhere: [passage.archived_section, archivedPages].filter(Boolean).join(', '),
      }
    })
    .sort((a, b) => b.similarity - a.similarity)
}
