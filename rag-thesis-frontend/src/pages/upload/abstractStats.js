/**
 * The upload form's abstract, measured.
 *
 * Lives here rather than in the component for the same reason
 * `extractionDepartment` does: it is a rule, and a rule is worth testing
 * without mounting JSX.
 */

/**
 * The ceiling `_validate_metadata` enforces in
 * rag-thesis-backend/routers/upload.py, which answers 422 above it. The
 * extractor clips an autofilled abstract to the same number
 * (`_ABSTRACT_MAX_CHARS`). Change one and change the other, or the form will
 * happily hold text the API refuses.
 */
export const ABSTRACT_MAX_CHARS = 10000

/**
 * An ISU abstract runs 150-350 words. This band is wider than that on both
 * sides on purpose: it drives a quiet nudge, not a validation rule, and the
 * abstract is an optional field whose Review button it must never block.
 */
export const ABSTRACT_IDEAL_WORDS = Object.freeze({ min: 120, max: 400 })

// Where the character count stops being trivia and starts being a warning.
const NEAR_LIMIT_RATIO = 0.9

function resolveTone(chars, words) {
  if (!words) return 'empty'
  // The ceiling outranks the word band: an abstract about to be truncated is
  // the more urgent thing to say about it.
  if (chars >= ABSTRACT_MAX_CHARS * NEAR_LIMIT_RATIO) return 'limit'
  if (words < ABSTRACT_IDEAL_WORDS.min) return 'brief'
  if (words > ABSTRACT_IDEAL_WORDS.max) return 'long'
  return 'ideal'
}

/**
 * Counts and a single tone for one abstract.
 *
 * Words, not characters, are what the reader is given: an abstract is
 * specified in words everywhere it is specified at all, and '1416 chars' told
 * an uploader nothing they could act on. The character count stays available
 * for the one case where it matters — approaching the API's ceiling.
 */
export function abstractStats(value = '') {
  const text = typeof value === 'string' ? value : ''
  const trimmed = text.trim()
  const chars = text.length
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  return {
    chars,
    words,
    ratio: Math.min(1, chars / ABSTRACT_MAX_CHARS),
    tone: resolveTone(chars, words),
  }
}
