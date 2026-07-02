import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildArcs, fibonacciSphere, makeGlowTexture, mulberry32 } from './constellation'

const NODE_COUNT = 140
const HUB_COUNT = 12
const RADIUS = 2

/* Theme palettes — materials LERP toward these each frame so toggling the
   site theme cross-fades the whole scene instead of popping. */
const PALETTES = {
  dark: {
    node: new THREE.Color('#34d388'),
    hub: new THREE.Color('#ffc72c'),
    arc: new THREE.Color('#10b96c'),
    arcOpacity: 0.22,
    halo: new THREE.Color('#10b96c'),
    haloOpacity: 0.5,
    core: new THREE.Color('#0a5c36'),
    coreOpacity: 0.55,
    coreGlow: new THREE.Color('#10b96c'),
    coreGlowOpacity: 0.5,
    pulse: new THREE.Color('#ffc72c'),
    pulseOpacity: 0.95,
  },
  light: {
    node: new THREE.Color('#046a38'),
    hub: new THREE.Color('#b45309'),
    arc: new THREE.Color('#059656'),
    arcOpacity: 0.35,
    halo: new THREE.Color('#34d388'),
    haloOpacity: 0.22,
    core: new THREE.Color('#046a38'),
    coreOpacity: 0.4,
    coreGlow: new THREE.Color('#6ee7ab'),
    coreGlowOpacity: 0.16,
    pulse: new THREE.Color('#f2a900'),
    pulseOpacity: 0.85,
  },
}

export function ConstellationOrb({ isDark, pointerRef, scrollProgress, degraded = false }) {
  const groupRef = useRef(null)
  const nodesRef = useRef(null)
  const hubsRef = useRef(null)
  const nodeMatRef = useRef(null)
  const hubMatRef = useRef(null)
  const arcMatRef = useRef(null)
  const haloMatRef = useRef(null)
  const coreMatRef = useRef(null)
  const coreGlowMatRef = useRef(null)
  const pulseRefs = useRef([])
  const spinRef = useRef(0)
  const smoothPointer = useRef({ x: 0, y: 0 })
  const randRef = useRef(mulberry32(1234))
  // Mutable per-node "citation arrived" flash intensities (scratch buffer).
  const boostRef = useRef(new Float32Array(NODE_COUNT))
  // Capture the mount-time theme for initial material colors; lerp handles changes.
  const [initialPalette] = useState(() => PALETTES[isDark ? 'dark' : 'light'])

  /* ---- Seeded, memoized geometry ---- */
  const { regular, hubs, phases, haloPositions, allNodes } = useMemo(() => {
    const rand = mulberry32(42)
    const allNodes = fibonacciSphere(NODE_COUNT, RADIUS)
    const phases = new Float32Array(NODE_COUNT)
    for (let i = 0; i < NODE_COUNT; i++) phases[i] = rand() * Math.PI * 2

    const hubSet = new Set()
    while (hubSet.size < HUB_COUNT) hubSet.add(Math.floor(rand() * NODE_COUNT))

    const regular = []
    const hubs = []
    allNodes.forEach((v, i) => {
      if (hubSet.has(i)) hubs.push({ position: v, global: i })
      else regular.push({ position: v, global: i })
    })

    const haloPositions = new Float32Array(NODE_COUNT * 3)
    allNodes.forEach((v, i) => {
      haloPositions[i * 3] = v.x
      haloPositions[i * 3 + 1] = v.y
      haloPositions[i * 3 + 2] = v.z
    })

    return { regular, hubs, phases, haloPositions, allNodes }
  }, [])

  const { curves, pairs, geometry: arcGeometry } = useMemo(
    () => buildArcs(allNodes, RADIUS, { maxArcs: degraded ? 40 : 64, seed: 7 }),
    [allNodes, degraded],
  )

  const glowTexture = useMemo(() => makeGlowTexture(64), [])

  /* Traveling "citation" pulses — each owns a curve, offset and speed. */
  const pulses = useMemo(() => {
    const rand = mulberry32(99)
    const count = degraded ? 5 : 10
    return Array.from({ length: count }, () => ({
      curve: Math.floor(rand() * curves.length),
      offset: rand(),
      speed: 0.1 + rand() * 0.16,
      lastU: 0,
    }))
  }, [curves, degraded])

  /* Glow sprites use additive blending in the dark theme only — additive
     washes out to white on the ivory background. */
  useEffect(() => {
    const blending = isDark ? THREE.AdditiveBlending : THREE.NormalBlending
    ;[haloMatRef.current, coreGlowMatRef.current].forEach((m) => {
      if (m) {
        m.blending = blending
        m.needsUpdate = true
      }
    })
    pulseRefs.current.forEach((sprite) => {
      if (sprite?.material) {
        sprite.material.blending = blending
        sprite.material.needsUpdate = true
      }
    })
  }, [isDark])

  const scratch = useMemo(() => new THREE.Object3D(), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const target = PALETTES[isDark ? 'dark' : 'light']
    const group = groupRef.current
    if (!group) return

    /* --- Group motion: idle spin + pointer parallax + scroll tumble --- */
    const p = scrollProgress?.get() ?? 0
    const k = 1 - Math.exp(-3.5 * dt)
    spinRef.current += dt * 0.1
    const px = pointerRef?.current?.x ?? 0
    const py = pointerRef?.current?.y ?? 0
    smoothPointer.current.x += (px - smoothPointer.current.x) * k
    smoothPointer.current.y += (py - smoothPointer.current.y) * k
    group.rotation.x = smoothPointer.current.y * 0.22 + p * 0.7
    group.rotation.y = spinRef.current + smoothPointer.current.x * 0.32
    group.scale.setScalar(Math.max(0.001, 1 - p * 0.22))

    /* --- Node pulse (instance matrices) + citation-arrival flash --- */
    const boost = boostRef.current
    for (let i = 0; i < NODE_COUNT; i++) boost[i] = Math.max(0, boost[i] - dt * 2.2)

    const writeInstances = (mesh, list, baseScale) => {
      if (!mesh) return
      for (let i = 0; i < list.length; i++) {
        const { position, global } = list[i]
        const s =
          baseScale * (1 + 0.35 * Math.sin(t * 1.6 + phases[global]) * 0.5 + boost[global])
        scratch.position.copy(position)
        scratch.scale.setScalar(s)
        scratch.updateMatrix()
        mesh.setMatrixAt(i, scratch.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    writeInstances(nodesRef.current, regular, 1)
    writeInstances(hubsRef.current, hubs, 1.7)

    /* --- Pulses travel their arcs; on arrival, flash the destination --- */
    pulses.forEach((pulse, i) => {
      const sprite = pulseRefs.current[i]
      if (!sprite) return
      const u = (t * pulse.speed + pulse.offset) % 1
      if (u < pulse.lastU) pulse.curve = Math.floor(randRef.current() * curves.length)
      pulse.lastU = u
      curves[pulse.curve].getPointAt(u, sprite.position)
      sprite.scale.setScalar(0.11 * (0.6 + 0.8 * Math.sin(u * Math.PI)))
      if (u > 0.93) {
        const dest = pairs[pulse.curve][1]
        boost[dest] = Math.min(1.2, boost[dest] + dt * 14)
      }
    })

    /* --- Theme cross-fade: lerp material colors/opacities toward target --- */
    const ck = 1 - Math.exp(-4 * dt)
    const fade = (mat, color, opacity) => {
      if (!mat) return
      if (color) mat.color.lerp(color, ck)
      if (opacity !== undefined) mat.opacity += (opacity - mat.opacity) * ck
    }
    fade(nodeMatRef.current, target.node)
    fade(hubMatRef.current, target.hub)
    fade(arcMatRef.current, target.arc, target.arcOpacity)
    fade(haloMatRef.current, target.halo, target.haloOpacity)
    fade(coreMatRef.current, target.core, target.coreOpacity)
    fade(coreGlowMatRef.current, target.coreGlow, target.coreGlowOpacity)
    pulseRefs.current.forEach((sprite) =>
      fade(sprite?.material, target.pulse, target.pulseOpacity),
    )
  })

  return (
    <group ref={groupRef}>
      {/* Regular nodes */}
      <instancedMesh ref={nodesRef} args={[undefined, undefined, regular.length]} frustumCulled={false}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial ref={nodeMatRef} color={initialPalette.node} transparent opacity={0.95} />
      </instancedMesh>

      {/* Gold hub nodes */}
      <instancedMesh ref={hubsRef} args={[undefined, undefined, hubs.length]} frustumCulled={false}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial ref={hubMatRef} color={initialPalette.hub} transparent opacity={0.98} />
      </instancedMesh>

      {/* Soft halo behind every node */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[haloPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={haloMatRef}
          map={glowTexture}
          color={initialPalette.halo}
          size={0.16}
          transparent
          opacity={initialPalette.haloOpacity}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {/* Citation arcs — one merged LineSegments draw call */}
      <lineSegments geometry={arcGeometry} frustumCulled={false}>
        <lineBasicMaterial
          ref={arcMatRef}
          color={initialPalette.arc}
          transparent
          opacity={initialPalette.arcOpacity}
        />
      </lineSegments>

      {/* Traveling citation pulses */}
      {pulses.map((_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            pulseRefs.current[i] = el
          }}
          scale={[0.11, 0.11, 0.11]}
        >
          <spriteMaterial
            map={glowTexture}
            color={initialPalette.pulse}
            transparent
            opacity={initialPalette.pulseOpacity}
            depthWrite={false}
          />
        </sprite>
      ))}

      {/* Core: inner sphere + one large glow sprite (the "bloom") */}
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshBasicMaterial
          ref={coreMatRef}
          color={initialPalette.core}
          transparent
          opacity={initialPalette.coreOpacity}
        />
      </mesh>
      <sprite scale={[5, 5, 1]}>
        <spriteMaterial
          ref={coreGlowMatRef}
          map={glowTexture}
          color={initialPalette.coreGlow}
          transparent
          opacity={initialPalette.coreGlowOpacity}
          depthWrite={false}
        />
      </sprite>
    </group>
  )
}
