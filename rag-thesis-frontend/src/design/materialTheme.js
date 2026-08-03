import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities'
import { SURFACE_TONES, TEXT_TONES, textToneKey } from './tokens.js'

export const MATERIAL_SEEDS = Object.freeze({
  isu: '#046A38',
  emerald: '#006D46',
  gold: '#735C00',
})

const GOLD_SEED = '#FFC72C'
const FLAME_SEED = '#D22630'

function scheme(seed, dark) {
  const generated = themeFromSourceColor(argbFromHex(seed)).schemes
  return (dark ? generated.dark : generated.light).toJSON()
}

function color(value, role = 'Material color role') {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${role} did not resolve to an ARGB color`)
  }
  return hexFromArgb(value).toUpperCase()
}

export function materialSemanticTokens({ palette = 'isu', dark = false, highContrast = false } = {}) {
  const generated = themeFromSourceColor(argbFromHex(MATERIAL_SEEDS[palette] || MATERIAL_SEEDS.isu))
  const primary = (dark ? generated.schemes.dark : generated.schemes.light).toJSON()
  const neutral = generated.palettes.neutral
  const gold = scheme(GOLD_SEED, dark)
  const flame = scheme(FLAME_SEED, dark)
  // themeFromSourceColor returns the legacy Scheme contract, which does not
  // expose the newer surfaceContainer* roles, so they are derived explicitly
  // instead of letting an undefined role convert silently into opaque black.
  const surfaceTones = SURFACE_TONES[dark ? 'dark' : 'light']
  const surfaces = Object.fromEntries(
    Object.entries(surfaceTones).map(([role, tone]) => [
      role,
      color(neutral.tone(tone), `surface ${role}`),
    ]),
  )
  const onSurface = highContrast ? (dark ? '#FFFFFF' : '#000000') : color(primary.onSurface)
  const outline = highContrast ? (dark ? '#FFFFFF' : '#000000') : color(primary.outlineVariant)
  const textTones = TEXT_TONES[textToneKey({ dark, highContrast })]
  return {
    '--background': color(primary.background),
    '--foreground': onSurface,
    '--card': `${surfaces.low}E6`,
    '--card-foreground': onSurface,
    '--popover': surfaces.container,
    '--popover-foreground': onSurface,
    '--primary': color(primary.primary),
    '--primary-foreground': color(primary.onPrimary),
    '--primary-container': color(primary.primaryContainer),
    '--primary-container-foreground': color(primary.onPrimaryContainer),
    '--secondary': color(gold.primary),
    '--secondary-foreground': color(gold.onPrimary),
    '--secondary-container': color(gold.primaryContainer),
    '--secondary-container-foreground': color(gold.onPrimaryContainer),
    '--tertiary': color(primary.tertiary),
    '--tertiary-foreground': color(primary.onTertiary),
    '--muted': surfaces.container,
    '--muted-foreground': color(primary.onSurfaceVariant),
    '--text-primary': onSurface,
    '--text-secondary': color(neutral.tone(textTones.secondary), 'secondary text'),
    '--text-tertiary': color(neutral.tone(textTones.tertiary), 'tertiary text'),
    '--accent': color(primary.secondaryContainer),
    '--accent-foreground': color(primary.onSecondaryContainer),
    '--destructive': color(flame.primary),
    '--destructive-foreground': color(flame.onPrimary),
    '--border': `${outline}${highContrast ? 'FF' : '38'}`,
    '--input': `${outline}${highContrast ? 'FF' : '52'}`,
    '--ring': color(gold.primary),
    '--surface-0': surfaces.surface,
    '--surface-1': surfaces.low,
    '--surface-2': surfaces.container,
    '--surface-3': surfaces.high,
  }
}

export function applyMaterialTheme(root, options) {
  const tokens = materialSemanticTokens(options)
  Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(name, value))
  return tokens
}
