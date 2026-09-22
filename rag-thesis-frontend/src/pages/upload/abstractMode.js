/**
 * Which of the two abstracts the upload wizard is holding.
 *
 * A manuscript carries its own abstract, and `POST /upload/extract-metadata`
 * reads that page verbatim. Some uploaders want the longer summary instead:
 * `POST /upload/extended-abstract` hands the manuscript to Gemini and asks for
 * one. Both land in the same form field, so the wizard has to track which text
 * is on screen, keep the other one within a click, and never claim the
 * manuscript's own words were written by a model.
 *
 * The rules live here rather than in the component for the reason
 * `extractionDepartment` and `abstractStats` do: a rule is worth testing
 * without mounting JSX.
 */

export const ABSTRACT_MODES = Object.freeze({
  document: 'document',
  extended: 'extended',
})

/** Left to right in the control. The manuscript's own text leads, and is the default. */
export const ABSTRACT_MODE_ORDER = Object.freeze([
  ABSTRACT_MODES.document,
  ABSTRACT_MODES.extended,
])

/**
 * What the control says about each setting.
 *
 * `provenance` is the wording the autofill chip carries once a value is in the
 * field. It is the one string here that has to stay literal: an AI-written
 * abstract reaches the archive card and the duplication summary through the
 * same column a verbatim one does, and this label is where an uploader learns
 * which they are about to submit.
 */
export const ABSTRACT_MODE_COPY = Object.freeze({
  [ABSTRACT_MODES.document]: Object.freeze({
    label: 'In document',
    hint: "The manuscript's own abstract page, word for word.",
    provenance: 'Read from the PDF',
  }),
  [ABSTRACT_MODES.extended]: Object.freeze({
    label: 'AI extended',
    hint: 'A longer summary Gemini writes from the manuscript itself.',
    provenance: 'Written by AI',
  }),
})

export function isAbstractMode(value) {
  return value === ABSTRACT_MODES.document || value === ABSTRACT_MODES.extended
}

export function emptyAbstractVariants() {
  return { [ABSTRACT_MODES.document]: '', [ABSTRACT_MODES.extended]: '' }
}

/**
 * Move the control to `mode`, and say what the field should now hold.
 *
 * Whatever is on screen is filed under the mode it was shown as first, edits
 * included: switching away and back must not be a way to lose typing, and an
 * uploader who trims an AI summary and then checks the original against it
 * would otherwise find their trimming gone.
 *
 * `fetch` is true only for the extended text and only while it is still
 * unknown for this manuscript — one generation per file, however often the
 * control is flipped.
 */
export function switchAbstractMode({ mode, from, current = '', variants }) {
  const kept = { ...emptyAbstractVariants(), ...variants, [from]: current }
  const next = kept[mode] || ''
  return {
    mode,
    variants: kept,
    abstract: next,
    fetch: mode === ABSTRACT_MODES.extended && !next,
  }
}

/**
 * File a value the server just produced under the mode it belongs to.
 *
 * The extended endpoint answers with the verbatim abstract and
 * `extended: false` when it could not write the longer one, so the reply says
 * which slot it fills rather than the request. Filing a fallback under
 * `extended` would leave the control claiming a model wrote the manuscript's
 * own sentences, and would spend the one generation this file gets.
 */
export function receivedAbstract(variants, { abstract = '', extended = false }) {
  const mode = extended ? ABSTRACT_MODES.extended : ABSTRACT_MODES.document
  return {
    mode,
    variants: { ...emptyAbstractVariants(), ...variants, [mode]: abstract },
    abstract,
    extended: Boolean(extended),
  }
}
