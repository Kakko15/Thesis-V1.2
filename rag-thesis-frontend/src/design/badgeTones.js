/* Badge tone resolution.
 *
 * A plain module rather than constants inside Badge.jsx so the resolution is
 * directly testable: the unit runner cannot import JSX, and the previous
 * arrangement could only be inspected by regex — which is why a tone that
 * resolved to `undefined`, and rendered a badge with no colour at all, passed
 * every check until someone looked at the page. See badgeTones.test.js.
 */

/** The audited palette. Foregrounds are paired with the tint each badge
 * actually renders on, not picked from the same colour family by eye: a /12
 * tint lightens the surface just enough to break AA, which is how
 * text-flame-600 ended up at 4.06:1. Ratios are checked against the tint
 * composited over the lightest and darkest surfaces a badge can sit on. */
export const BADGE_TONE_CLASSES = {
  forest: 'bg-forest-600/12 text-forest-900 dark:bg-forest-400/15 dark:text-forest-200 border-forest-600/20',
  gold: 'bg-gold-400/15 text-gold-text dark:text-gold-200 border-gold-400/25',
  flame: 'bg-flame-500/12 text-flame-800 dark:bg-flame-500/15 dark:text-flame-200 border-flame-500/20',
  neutral: 'bg-forest-900/8 text-ink-muted dark:bg-white/8 border-transparent',
}

/** Semantic names, for callers that mean "this is good / needs attention / is
 * wrong" rather than naming a hue. They point at the audited tones above
 * instead of carrying their own colours, so the AA guarantees cover them too.
 * The account-status column asked for these three and got nothing back. */
export const BADGE_TONE_ALIASES = {
  success: 'forest',
  warning: 'gold',
  critical: 'flame',
}

/** The default tone, applied when a caller names none. */
export const DEFAULT_BADGE_TONE = 'forest'

/** The utility classes for `tone`.
 *
 * An unrecognised tone degrades to neutral: a visible, legible badge is a far
 * better failure than an invisible one, and returning `undefined` here is the
 * bug this function exists to prevent. */
export function badgeToneClass(tone = DEFAULT_BADGE_TONE) {
  const resolved = BADGE_TONE_ALIASES[tone] ?? tone
  return BADGE_TONE_CLASSES[resolved] ?? BADGE_TONE_CLASSES.neutral
}
