import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeGlowTexture, mulberry32 } from './constellation'

const COLORS = {
  dark: { color: new THREE.Color('#6ee7ab'), opacity: 0.55 },
  light: { color: new THREE.Color('#059656'), opacity: 0.35 },
}

/** Seeded points in a spherical shell between rMin and rMax. */
function shellPositions(count, rMin, rMax, seed) {
  const rand = mulberry32(seed)
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = rMin + rand() * (rMax - rMin)
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(2 * rand() - 1)
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    arr[i * 3 + 1] = r * Math.cos(phi)
    arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  return arr
}

/**
 * Ambient "knowledge dust" around the orb — two counter-rotating shells
 * for cheap parallax depth. One draw call per shell.
 */
export function ParticleField({ isDark, count = 600 }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const matARef = useRef(null)
  const matBRef = useRef(null)

  const outerCount = Math.ceil(count * 0.6)
  const innerCount = count - outerCount
  const outer = useMemo(() => shellPositions(outerCount, 3.2, 4.4, 2024), [outerCount])
  const inner = useMemo(() => shellPositions(innerCount, 2.6, 3.2, 4048), [innerCount])
  const glowTexture = useMemo(() => makeGlowTexture(32), [])

  useFrame((state, dt) => {
    if (outerRef.current) outerRef.current.rotation.y += dt * 0.02
    if (innerRef.current) {
      innerRef.current.rotation.y -= dt * 0.035
      innerRef.current.rotation.x += dt * 0.008
    }
    const target = COLORS[isDark ? 'dark' : 'light']
    const ck = 1 - Math.exp(-4 * dt)
    ;[matARef.current, matBRef.current].forEach((m) => {
      if (!m) return
      m.color.lerp(target.color, ck)
      m.opacity += (target.opacity - m.opacity) * ck
      const blending = isDark ? THREE.AdditiveBlending : THREE.NormalBlending
      if (m.blending !== blending) {
        m.blending = blending
        m.needsUpdate = true
      }
    })
  })

  return (
    <>
      <group ref={outerRef}>
        <points frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[outer, 3]} />
          </bufferGeometry>
          <pointsMaterial
            ref={matARef}
            map={glowTexture}
            color="#6ee7ab"
            size={0.055}
            transparent
            opacity={0.5}
            depthWrite={false}
            sizeAttenuation
          />
        </points>
      </group>
      <group ref={innerRef}>
        <points frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[inner, 3]} />
          </bufferGeometry>
          <pointsMaterial
            ref={matBRef}
            map={glowTexture}
            color="#6ee7ab"
            size={0.045}
            transparent
            opacity={0.5}
            depthWrite={false}
            sizeAttenuation
          />
        </points>
      </group>
    </>
  )
}
