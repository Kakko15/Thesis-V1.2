import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BLOCK_REASONS,
  MIN_DEVICE_MEMORY_GB,
  MIN_LOGICAL_CORES,
  detectWebgl,
  evaluateSceneCapability,
  readBrowserSignals,
} from './sceneCapability.js'

/** A device that should get the scene, so each test varies one signal. */
const CAPABLE = {
  reducedMotion: false,
  effects: 'balanced',
  webgl: true,
  wideViewport: true,
  pageVisible: true,
  pointerCoarse: false,
  saveData: false,
  deviceMemory: 8,
  logicalCores: 8,
}

const verdict = (overrides) => evaluateSceneCapability({ ...CAPABLE, ...overrides })

describe('evaluateSceneCapability', () => {
  it('allows a capable desktop', () => {
    assert.deepEqual(verdict({}), { allowed: true, reason: null })
  })

  it('defaults to blocking when nothing is known', () => {
    // webgl defaults false: never ship 237 kB of WebGL on an unverified guess.
    assert.equal(evaluateSceneCapability().allowed, false)
    assert.equal(evaluateSceneCapability().reason, BLOCK_REASONS.NO_WEBGL)
  })

  describe('hard constraints that nothing overrides', () => {
    const HARD = [
      ['no WebGL', { webgl: false }, BLOCK_REASONS.NO_WEBGL],
      ['reduced motion', { reducedMotion: true }, BLOCK_REASONS.REDUCED_MOTION],
      ['Data Saver', { saveData: true }, BLOCK_REASONS.SAVE_DATA],
      ['low memory', { deviceMemory: 2 }, BLOCK_REASONS.LOW_MEMORY],
      ['few cores', { logicalCores: 2 }, BLOCK_REASONS.LOW_CPU],
    ]

    for (const [label, signal, reason] of HARD) {
      it(`blocks on ${label}`, () => {
        assert.deepEqual(verdict(signal), { allowed: false, reason })
      })

      // 'low effects' is excluded from this loop on purpose: its signal *is* the
      // effects field, so setting effects to 'full' replaces the condition
      // rather than testing whether it can be overridden.
      it(`still blocks on ${label} even when effects is 'full'`, () => {
        assert.equal(verdict({ ...signal, effects: 'full' }).allowed, false)
      })
    }

    it('blocks on low effects', () => {
      assert.deepEqual(verdict({ effects: 'low' }), {
        allowed: false, reason: BLOCK_REASONS.LOW_EFFECTS,
      })
    })

    it("keeps blocking Data Saver under an explicit 'full' opt-in", () => {
      // Data Saver is the browser relaying an instruction to spend less data.
      // That outranks a decorative preference set once in a settings panel.
      const result = verdict({ saveData: true, effects: 'full' })
      assert.deepEqual(result, { allowed: false, reason: BLOCK_REASONS.SAVE_DATA })
    })
  })

  describe('soft preferences an explicit opt-in overrides', () => {
    it('blocks a coarse pointer by default', () => {
      assert.deepEqual(verdict({ pointerCoarse: true }), {
        allowed: false, reason: BLOCK_REASONS.COARSE_POINTER,
      })
    })

    it('allows a coarse pointer when the user chose full effects', () => {
      assert.equal(verdict({ pointerCoarse: true, effects: 'full' }).allowed, true)
    })

    it('blocks a narrow viewport by default', () => {
      assert.deepEqual(verdict({ wideViewport: false }), {
        allowed: false, reason: BLOCK_REASONS.SMALL_VIEWPORT,
      })
    })

    it('allows a narrow viewport when the user chose full effects', () => {
      assert.equal(verdict({ wideViewport: false, effects: 'full' }).allowed, true)
    })
  })

  describe('unknown readings never block', () => {
    it('allows when memory and core count are unreported', () => {
      // Safari and Firefox expose neither. Absent must not read as low.
      assert.equal(verdict({ deviceMemory: null, logicalCores: null }).allowed, true)
    })

    it('allows when memory and core count are undefined', () => {
      assert.equal(verdict({ deviceMemory: undefined, logicalCores: undefined }).allowed, true)
    })

    it('allows when a reading is a nonsensical zero', () => {
      assert.equal(verdict({ deviceMemory: 0, logicalCores: 0 }).allowed, true)
    })

    it('allows when a reading is not a number', () => {
      assert.equal(verdict({ deviceMemory: 'lots', logicalCores: NaN }).allowed, true)
    })
  })

  describe('the thresholds themselves', () => {
    it('accepts a reading exactly at the floor', () => {
      assert.equal(verdict({ deviceMemory: MIN_DEVICE_MEMORY_GB }).allowed, true)
      assert.equal(verdict({ logicalCores: MIN_LOGICAL_CORES }).allowed, true)
    })

    it('rejects a reading just below the floor', () => {
      assert.equal(verdict({ deviceMemory: MIN_DEVICE_MEMORY_GB - 1 }).allowed, false)
      assert.equal(verdict({ logicalCores: MIN_LOGICAL_CORES - 1 }).allowed, false)
    })
  })

  it('reports a hidden page separately from a capability failure', () => {
    // The hero distinguishes these: a hidden tab pauses the render loop, but
    // unmounting the scene would drop its GL context.
    assert.deepEqual(verdict({ pageVisible: false }), {
      allowed: false, reason: BLOCK_REASONS.PAGE_HIDDEN,
    })
  })

  it('ranks a real capability failure above page visibility', () => {
    const result = verdict({ pageVisible: false, webgl: false })
    assert.equal(result.reason, BLOCK_REASONS.NO_WEBGL)
  })

  it('names every reason it can return', () => {
    const declared = new Set(Object.values(BLOCK_REASONS))
    const probes = [
      { webgl: false }, { reducedMotion: true }, { effects: 'low' }, { saveData: true },
      { deviceMemory: 1 }, { logicalCores: 1 }, { pointerCoarse: true },
      { wideViewport: false }, { pageVisible: false },
    ]
    const seen = new Set(probes.map((p) => verdict(p).reason))
    assert.deepEqual([...seen].sort(), [...declared].sort())
  })
})

describe('readBrowserSignals', () => {
  it('reads Data Saver, memory, and cores when present', () => {
    assert.deepEqual(readBrowserSignals({
      connection: { saveData: true }, deviceMemory: 4, hardwareConcurrency: 12,
    }), { saveData: true, deviceMemory: 4, logicalCores: 12 })
  })

  it('falls back to the vendor-prefixed connection objects', () => {
    assert.equal(readBrowserSignals({ mozConnection: { saveData: true } }).saveData, true)
    assert.equal(readBrowserSignals({ webkitConnection: { saveData: true } }).saveData, true)
  })

  it('reports unknown rather than zero when the APIs are absent', () => {
    assert.deepEqual(readBrowserSignals({}), {
      saveData: false, deviceMemory: null, logicalCores: null,
    })
  })

  it('survives a missing navigator entirely', () => {
    // Explicitly null, not undefined: undefined would fall through to the
    // parameter default, and Node's own globalThis.navigator reports a real
    // hardwareConcurrency, so the test would assert against the host machine.
    assert.deepEqual(readBrowserSignals(null), {
      saveData: false, deviceMemory: null, logicalCores: null,
    })
  })

  it('does not treat a non-numeric reading as a number', () => {
    const signals = readBrowserSignals({ deviceMemory: '4', hardwareConcurrency: null })
    assert.equal(signals.deviceMemory, null)
    assert.equal(signals.logicalCores, null)
  })
})

describe('detectWebgl', () => {
  const canvasWith = (contexts) => ({
    createElement: () => ({ getContext: (name) => (contexts.includes(name) ? {} : null) }),
  })

  it('detects webgl2', () => {
    assert.equal(detectWebgl(canvasWith(['webgl2'])), true)
  })

  it('falls back to webgl1', () => {
    assert.equal(detectWebgl(canvasWith(['webgl'])), true)
  })

  it('reports false when no context is available', () => {
    assert.equal(detectWebgl(canvasWith([])), false)
  })

  it('reports false instead of throwing when canvas creation fails', () => {
    assert.equal(detectWebgl({ createElement() { throw new Error('blocked') } }), false)
  })
})
