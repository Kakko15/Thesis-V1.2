/**
 * Option bookkeeping for the shared `Select` (components/ui/Input.jsx).
 *
 * Radix Select reserves the empty string: an item may not carry value '' and a
 * root value of '' means "show the placeholder". The component therefore used
 * to treat every `<option value="">` as placeholder text and drop it from the
 * list. That was right for form prompts such as "Select program…", but it also
 * removed real choices -- "All categories", "All years", "Default (CCSICT)" --
 * so once a user picked anything else there was no way back. Measured
 * 2026-11-25 in user testing: the Settings default category got stuck on
 * "Faculty Research", which has no theses, and every chat answered "No
 * relevant thesis was found".
 *
 * The rule now matches a native `<select>`: an empty-value option is a normal,
 * selectable choice, unless it is marked `hidden` (the native placeholder
 * idiom), in which case it is only the placeholder text. Internally the empty
 * value travels as EMPTY_OPTION_VALUE so Radix never sees ''.
 */

export const EMPTY_OPTION_VALUE = '__isu-select-empty__'

function optionValue(option) {
  return String(option?.props?.value ?? '')
}

/**
 * Split `<option>` elements into the placeholder and the dropdown items.
 *
 * Returns `{ placeholderOption, emptySelectable, items }`, where `items` is
 * `[{ key, value, disabled, label }]` with the empty value already mapped to
 * EMPTY_OPTION_VALUE.
 */
export function resolveSelectOptions(options = []) {
  const placeholderOption = options.find((option) => optionValue(option) === '') || null
  const emptySelectable = Boolean(placeholderOption && !placeholderOption.props.hidden)
  const items = []
  for (const option of options) {
    const value = optionValue(option)
    if (value === '' && (option !== placeholderOption || !emptySelectable)) continue
    items.push({
      key: option.key || value || EMPTY_OPTION_VALUE,
      value: value === '' ? EMPTY_OPTION_VALUE : value,
      disabled: Boolean(option.props.disabled),
      label: option.props.children,
    })
  }
  return { placeholderOption, emptySelectable, items }
}

/** The value handed to Radix for a caller's controlled or default value. */
export function toRootValue(value, emptySelectable) {
  if (value == null) return undefined
  const text = String(value)
  if (text === '') return emptySelectable ? EMPTY_OPTION_VALUE : ''
  return text
}

/** The value reported back to the caller for a Radix selection. */
export function fromItemValue(value) {
  return value === EMPTY_OPTION_VALUE ? '' : value
}
