import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Html } from '@react-three/drei'

/* Real archive entries (titles shortened only where the full title would not
   fit the card). Replaced fictional cards under retired track names. */
const CARDS = [
  {
    title: 'FindMe: A Computer Vision-based Detector for Missing Person',
    track: 'BSCS',
    year: 2024,
    incline: 0.42,
    phase: 0,
    speed: 0.11,
  },
  {
    title: 'ISU-CANNER: A Document Monitoring and Tracking System Using QR Code',
    track: 'BSIT · WMAD',
    year: 2025,
    incline: -0.32,
    phase: 2.1,
    speed: 0.09,
  },
  {
    title: 'BLIS Beyond Graduation: Mapping Career Paths Through Alumni Profiling',
    track: 'BLIS',
    year: 2026,
    incline: 0.12,
    phase: 4.2,
    speed: 0.13,
  },
]

function OrbitingCard({ title, track, year, incline, phase, speed, radius = 2.95 }) {
  const ref = useRef(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed + phase
    ref.current?.position.set(Math.cos(t) * radius, 0, Math.sin(t) * radius)
  })

  return (
    // Tilt the whole orbit plane, then circle in flat XZ inside it.
    <group rotation={[0, 0, incline]}>
      <group ref={ref}>
        <Float speed={1.5} rotationIntensity={0.15} floatIntensity={0.5}>
          <Html
            transform
            distanceFactor={5.5}
            style={{ pointerEvents: 'none' }}
            className="select-none"
            zIndexRange={[5, 0]}
          >
            <div className="glass w-44 rounded-xl px-3.5 py-3 shadow-xl">
              <div className="font-display text-xs font-bold leading-snug">{title}</div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="truncate rounded-full bg-forest-500/15 px-2 py-0.5 font-semibold text-forest-700 dark:text-forest-300">
                  {track}
                </span>
                <span className="font-mono text-ink-muted">{year}</span>
              </div>
            </div>
          </Html>
        </Float>
      </group>
    </group>
  )
}

/** Three glass "thesis cards" orbiting the constellation on tilted rings. */
export function ThesisCards() {
  return (
    <>
      {CARDS.map((card) => (
        <OrbitingCard key={card.title} {...card} />
      ))}
    </>
  )
}
