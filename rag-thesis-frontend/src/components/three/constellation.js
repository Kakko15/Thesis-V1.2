import * as THREE from 'three'

/**
 * Pure geometry helpers for the hero "knowledge constellation" scene.
 * Everything is seeded so StrictMode remounts regenerate identical geometry.
 */

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `count` points evenly distributed on a sphere of `radius`. */
export function fibonacciSphere(count, radius) {
  const points = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = golden * i
    points.push(
      new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius),
    )
  }
  return points
}

/**
 * Citation arcs between nearby nodes. Each arc bows outward through a control
 * point pushed past the sphere surface. All arcs are sampled and merged into
 * ONE LineSegments geometry (a single draw call); the curves are returned too
 * so pulse sprites can travel along them.
 *
 * Returns { curves, pairs, geometry } where pairs[i] = [nodeIndexA, nodeIndexB].
 */
export function buildArcs(
  nodes,
  radius,
  { maxArcs = 64, minDist = 0.4, maxDist = 1.15, seed = 7, segments = 20 } = {},
) {
  const rand = mulberry32(seed)
  const curves = []
  const pairs = []
  const seen = new Set()
  const positions = []

  let attempts = maxArcs * 60
  while (curves.length < maxArcs && attempts-- > 0) {
    const i = Math.floor(rand() * nodes.length)
    const j = Math.floor(rand() * nodes.length)
    if (i === j) continue
    const key = i < j ? `${i}:${j}` : `${j}:${i}`
    if (seen.has(key)) continue
    const a = nodes[i]
    const b = nodes[j]
    const dist = a.distanceTo(b)
    if (dist < minDist || dist > maxDist) continue
    seen.add(key)

    const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(radius * 1.28)
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone())
    curves.push(curve)
    pairs.push([i, j])

    const pts = curve.getPoints(segments)
    for (let k = 0; k < pts.length - 1; k++) {
      positions.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return { curves, pairs, geometry }
}

/**
 * Soft radial glow texture — the "fake bloom" sprite. Cheaper than a real
 * EffectComposer Bloom pass (upgrade path: @react-three/postprocessing@^3
 * with <Bloom mipmapBlur luminanceThreshold={1}> and emissive colors > 1).
 */
export function makeGlowTexture(size = 64) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}
