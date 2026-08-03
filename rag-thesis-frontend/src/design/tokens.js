/**
 * Palette-independent tone constants for the Material 3 theme generator.
 *
 * Kept free of any `@material/material-color-utilities` import so unit tests can
 * read them: that package's entry point pulls in an extensionless specifier that
 * bare Node ESM cannot resolve.
 */

/** Material 3 defines the surface roles as tones of the neutral palette. */
export const SURFACE_TONES = Object.freeze({
  light: Object.freeze({ surface: 98, low: 96, container: 94, high: 92 }),
  dark: Object.freeze({ surface: 6, low: 10, container: 12, high: 17 }),
})

/**
 * The most de-emphasised neutral tone that still clears 4.5:1 against *every*
 * surface above, for all three palette seeds. Reproduce with:
 *
 *   node --input-type=module -e "
 *     import {CorePalette} from './node_modules/@material/material-color-utilities/palettes/core_palette.js'
 *     import {argbFromHex,hexFromArgb} from './node_modules/@material/material-color-utilities/utils/string_utils.js'
 *     // ... sweep tones 0-100, keep those >= 4.5:1 against every surface tone"
 *
 * Light text darkens as the tone falls, so its limit is an upper bound; dark
 * text brightens as the tone rises, so its limit is a lower bound.
 */
export const AA_TEXT_TONE_LIMIT = Object.freeze({ light: 44, dark: 60 })

/**
 * De-emphasised text used to be `opacity-*`, which blends the foreground into
 * whatever sits behind it — the effective ratio is unknowable at authoring time
 * and was measured as low as 1.04:1 on the upload-history stepper. These are
 * explicit neutral tones instead, each inside AA_TEXT_TONE_LIMIT with margin.
 * High contrast moves them toward the extremes rather than leaving them put.
 */
export const TEXT_TONES = Object.freeze({
  light: Object.freeze({ secondary: 36, tertiary: 41 }),
  dark: Object.freeze({ secondary: 72, tertiary: 65 }),
  lightHighContrast: Object.freeze({ secondary: 20, tertiary: 28 }),
  darkHighContrast: Object.freeze({ secondary: 92, tertiary: 84 }),
})

/** Which TEXT_TONES entry a given appearance state resolves to. */
export function textToneKey({ dark = false, highContrast = false } = {}) {
  if (highContrast) return dark ? 'darkHighContrast' : 'lightHighContrast'
  return dark ? 'dark' : 'light'
}
