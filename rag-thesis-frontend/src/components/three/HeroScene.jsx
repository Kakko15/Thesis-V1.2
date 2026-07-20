import { lazy, Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useIsDark } from '../../hooks/useIsDark'
import { ConstellationOrb } from './ConstellationOrb'
import { ParticleField } from './ParticleField'
import { useSceneRuntime } from './useSceneRuntime'

const ThesisCards = lazy(() => import('./ThesisCards').then((module) => ({ default: module.ThesisCards })))

/**
 * Lazy entry point for the hero 3D scene (the only file the landing page
 * dynamic-imports — keeps the entire three.js chunk out of the initial load).
 *
 * The canvas never receives pointer events; parallax reads a window-level
 * pointer so CTAs layered above stay fully clickable. `active={false}` pauses
 * the frameloop while the hero is far off-screen (instead of unmounting,
 * which would force a context loss).
 */
export default function HeroScene({ scrollProgress, active = true }) {
  const isDark = useIsDark()
  const { degraded, lost, onCreated, pointerRef, setDegraded } = useSceneRuntime()
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const onChange = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Context lost (GPU reset, tab eviction): fall back to the Aurora backdrop.
  if (lost) return null

  const simple = degraded || isMobile

  return (
    <Canvas
      aria-hidden="true"
      frameloop={active ? 'always' : 'never'}
      dpr={simple ? [1, 1.25] : [1, 2]}
      camera={{ position: [0, 0, 7.2], fov: 42 }}
      resize={{ scroll: false }}
      gl={{ alpha: true, antialias: !simple, powerPreference: 'high-performance' }}
      style={{ pointerEvents: 'none', background: 'transparent' }}
      onCreated={onCreated}
    >
      <PerformanceMonitor onDecline={() => setDegraded(true)}>
        <ConstellationOrb
          isDark={isDark}
          pointerRef={pointerRef}
          scrollProgress={scrollProgress}
          degraded={simple}
        />
        <ParticleField isDark={isDark} count={simple ? 260 : 600} />
        {!simple && <Suspense fallback={null}><ThesisCards /></Suspense>}
      </PerformanceMonitor>
    </Canvas>
  )
}
