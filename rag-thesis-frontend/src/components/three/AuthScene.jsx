import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useIsDark } from '../../hooks/useIsDark'
import { ConstellationOrb } from './ConstellationOrb'
import { ParticleField } from './ParticleField'

/**
 * Lazy 3D backdrop for the auth page — the hero constellation tuned down:
 * no orbiting cards, fewer particles, camera pulled back so the orb reads
 * as ambience behind the showcase copy rather than the subject. Only
 * mounted on desktop (the Login gate), so no mobile branch here.
 *
 * Same robustness story as HeroScene: pointer parallax reads a window-level
 * listener (canvas never takes pointer events), one automatic remount on
 * WebGL context loss, then permanent fallback to the Aurora backdrop.
 */
export default function AuthScene() {
  const isDark = useIsDark()
  const pointerRef = useRef({ x: 0, y: 0 })
  const [degraded, setDegraded] = useState(false)
  const [lost, setLost] = useState(false)
  const retriedRef = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointerRef.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  if (lost) return null

  return (
    <Canvas
      aria-hidden="true"
      dpr={degraded ? [1, 1.25] : [1, 1.75]}
      camera={{ position: [0, 0, 8.4], fov: 42 }}
      resize={{ scroll: false }}
      gl={{ alpha: true, antialias: !degraded, powerPreference: 'high-performance' }}
      style={{ pointerEvents: 'none', background: 'transparent' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (e) => {
            e.preventDefault()
            setLost(true)
            if (!retriedRef.current) {
              retriedRef.current = true
              setTimeout(() => setLost(false), 1500)
            }
          },
          { once: true },
        )
      }}
    >
      <PerformanceMonitor onDecline={() => setDegraded(true)}>
        <ConstellationOrb isDark={isDark} pointerRef={pointerRef} degraded={degraded} />
        <ParticleField isDark={isDark} count={degraded ? 220 : 430} />
      </PerformanceMonitor>
    </Canvas>
  )
}
