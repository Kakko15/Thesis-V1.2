/**
 * Decides whether a decorative WebGL scene has earned its download.
 *
 * The scene chunk is ~890 kB raw / ~237 kB gzipped of Three.js, react-three-fiber
 * and drei. It is purely ornamental: both surfaces that use it render a CSS
 * Aurora backdrop underneath, so blocking the scene costs nothing visually and
 * saves a multi-second wait on a campus mobile connection.
 *
 * Hero and Login each re-implemented this decision with slightly different
 * rules. They now share this one, which also adds the three signals neither
 * checked: Data Saver, device memory, and pointer coarseness.
 *
 * Two classes of gate, and the distinction is the whole design:
 *
 *   Hard constraints -- no WebGL, reduced motion, Data Saver, low memory, low
 *   CPU. These are capability or accessibility facts, or an explicit request to
 *   conserve data. Nothing overrides them, including `effects: 'full'`.
 *
 *   Soft preferences -- coarse pointer, narrow viewport. These are heuristics
 *   about whether the scene is worth it, so a user who deliberately selected
 *   `effects: 'full'` overrides them and gets the scene on their tablet.
 *
 * Data Saver deliberately sits in the first group. It is the browser relaying an
 * explicit instruction to spend less data, which outranks a decorative
 * preference set once in a settings panel.
 *
 * Unknown signals never block. navigator.deviceMemory and
 * navigator.hardwareConcurrency are absent in Safari and Firefox, and a missing
 * reading must not be read as a low one.
 */

export const MIN_DEVICE_MEMORY_GB = 4
export const MIN_LOGICAL_CORES = 4

export const BLOCK_REASONS = Object.freeze({
  NO_WEBGL: 'no-webgl',
  REDUCED_MOTION: 'reduced-motion',
  LOW_EFFECTS: 'low-effects',
  SAVE_DATA: 'save-data',
  LOW_MEMORY: 'low-memory',
  LOW_CPU: 'low-cpu',
  COARSE_POINTER: 'coarse-pointer',
  SMALL_VIEWPORT: 'small-viewport',
  PAGE_HIDDEN: 'page-hidden',
})

const blocked = (reason) => ({ allowed: false, reason })

/** True only for a real, positive numeric reading. */
function isBelow(value, floor) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < floor
}

export function evaluateSceneCapability({
  reducedMotion = false,
  effects = 'balanced',
  webgl = false,
  wideViewport = true,
  pageVisible = true,
  pointerCoarse = false,
  saveData = false,
  deviceMemory = null,
  logicalCores = null,
} = {}) {
  // --- Hard constraints: not overridable ---
  if (!webgl) return blocked(BLOCK_REASONS.NO_WEBGL)
  if (reducedMotion) return blocked(BLOCK_REASONS.REDUCED_MOTION)
  if (effects === 'low') return blocked(BLOCK_REASONS.LOW_EFFECTS)
  if (saveData) return blocked(BLOCK_REASONS.SAVE_DATA)
  if (isBelow(deviceMemory, MIN_DEVICE_MEMORY_GB)) return blocked(BLOCK_REASONS.LOW_MEMORY)
  if (isBelow(logicalCores, MIN_LOGICAL_CORES)) return blocked(BLOCK_REASONS.LOW_CPU)

  // --- Soft preferences: an explicit `full` opt-in wins ---
  const optedIn = effects === 'full'
  if (pointerCoarse && !optedIn) return blocked(BLOCK_REASONS.COARSE_POINTER)
  if (!wideViewport && !optedIn) return blocked(BLOCK_REASONS.SMALL_VIEWPORT)

  // Not a capability judgement -- just no reason to run a render loop nobody is
  // looking at. Re-evaluated when the tab comes back.
  if (!pageVisible) return blocked(BLOCK_REASONS.PAGE_HIDDEN)

  return { allowed: true, reason: null }
}

/** Read the capability signals a browser will actually give us. */
export function readBrowserSignals(navigatorLike = globalThis.navigator) {
  const connection = navigatorLike?.connection
    || navigatorLike?.mozConnection
    || navigatorLike?.webkitConnection
    || null
  return {
    saveData: Boolean(connection?.saveData),
    deviceMemory: typeof navigatorLike?.deviceMemory === 'number'
      ? navigatorLike.deviceMemory
      : null,
    logicalCores: typeof navigatorLike?.hardwareConcurrency === 'number'
      ? navigatorLike.hardwareConcurrency
      : null,
  }
}

/** Feature-detect WebGL without retaining the probe context. */
export function detectWebgl(documentLike = globalThis.document) {
  try {
    const canvas = documentLike.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
