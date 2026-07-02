import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Html } from '@react-three/drei'

/* Representative archive entries — mirrors the demo copy used on the page. */
const CARDS = [
  {
    title: 'CNN-Based Rice Leaf Disease Detection',
    track: 'Data Mining',
    year: 2023,
    incline: 0.42,
    phase: 0,
    speed: 0.11,
  },
  {
    title: 'Campus Network Intrusion Detection',
    track: 'Network Security',
    year: 2022,
    incline: -0.32,
    phase: 2.1,
    speed: 0.09,
  },
  {
    title: 'Enrollment Chatbot with NLP',
    track: 'Intelligent Systems',
    year: 2024,
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
              <div className="font-display text-[0.7rem] font-bold leading-snug">{title}</div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[0.6rem]">
                <span className="truncate rounded-full bg-forest-500/15 px-2 py-0.5 font-semibold text-forest-700 dark:text-forest-300">
                  {track}
                </span>
                <span className="font-mono opacity-60">{year}</span>
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
