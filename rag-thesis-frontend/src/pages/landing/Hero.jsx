import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowRight, ChevronDown, Lock, MessageSquareText, Quote, ShieldCheck, Sparkles,
} from 'lucide-react'
import { Aurora } from '../../components/ui/Aurora'
import { Button } from '../../components/ui/Button'
import { Magnetic, TypewriterText } from '../../components/ui/Motion'
import { usePreferences } from '../../context/PreferencesContext'

const HeroScene = lazy(() => import('../../components/three/HeroScene'))

const ASK_PHRASES = [
  'What local studies used CNNs for crop disease detection?',
  'Which theses tackled campus network security?',
  'Has anyone built an enrollment chatbot before?',
  'IoT irrigation studies between 2019 and 2024?',
]

const TRUST_CHIPS = [
  { icon: Lock, label: 'Closed-domain' },
  { icon: Quote, label: 'Citation-backed' },
  { icon: ShieldCheck, label: 'Human-reviewed novelty' },
]

const enter = (delay) => ({
  initial: { opacity: 0, y: 26 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.8, ease: [0.2, 0, 0, 1] },
})

/**
 * Gates the 3D scene. `show` mounts it once (reduced motion off + WebGL
 * available) and keeps it mounted — unmounting on scroll would force a GL
 * context loss (console noise, re-init cost). `active` pauses the render
 * loop instead while the hero is far off-screen.
 */
function useHeroScene(heroRef) {
  const { reducedMotion, effects } = usePreferences()
  const [webgl] = useState(() => {
    try {
      const canvas = document.createElement('canvas')
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
    } catch {
      return false
    }
  })
  const [near, setNear] = useState(true)
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')
  const [largeViewport, setLargeViewport] = useState(() => window.matchMedia('(min-width: 768px)').matches)

  useEffect(() => {
    const el = heroRef.current
    if (!el || !('IntersectionObserver' in window)) return undefined
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: '600px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [heroRef])

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const onChange = (event) => setLargeViewport(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return {
    show: !reducedMotion && effects !== 'low' && webgl && (largeViewport || effects === 'full'),
    active: near && pageVisible,
  }
}

export function Hero() {
  const navigate = useNavigate()
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const copyOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0.1])
  const copyY = useTransform(scrollYProgress, [0, 1], [0, 90])
  const { show: show3D, active: sceneActive } = useHeroScene(heroRef)

  return (
    <section ref={heroRef} className="relative min-h-screen overflow-hidden">
      <Aurora />

      {/* 3D constellation — full-bleed dim backdrop on mobile, right half on lg.
          pointer-events-none throughout: parallax reads the window pointer. */}
      <div
        aria-hidden="true"
        className="effects-decorative pointer-events-none absolute inset-0 z-0 opacity-60 lg:inset-y-0 lg:left-auto lg:right-[-10%] lg:w-[62%] lg:opacity-100"
      >
        {show3D && (
          <Suspense fallback={null}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.8, delay: 0.3, ease: 'easeOut' }}
              className="h-full w-full"
            >
              <HeroScene scrollProgress={scrollYProgress} active={sceneActive} />
            </motion.div>
          </Suspense>
        )}
      </div>

      {/* Text-protection wash so copy stays readable over the orb on mobile */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1] bg-gradient-to-b from-transparent via-transparent to-ivory-100 dark:to-canvas-950 lg:hidden"
      />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-6 pt-32 pb-24 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
        <motion.div style={{ opacity: copyOpacity, y: copyY }} className="text-center lg:text-left">
          {/* Badge with shine sweep */}
          <motion.div
            {...enter(0.1)}
            className="glass relative mx-auto inline-flex items-center gap-2 overflow-hidden rounded-full px-4 py-1.5 text-xs font-semibold lg:mx-0"
          >
            <Sparkles size={13} className="shrink-0 text-gold-400" />
            Retrieval-Augmented Generation · Closed-domain · Citation-backed
            <span
              aria-hidden="true"
              className="animate-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            />
          </motion.div>

          <motion.h1
            {...enter(0.2)}
            className="font-display mt-7 text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl xl:text-7xl"
          >
            Every ISU thesis,
            <br />
            <em className="font-accent text-gradient-isu">one intelligent answer</em>
            <span className="text-gold-400">.</span>
          </motion.h1>

          <motion.p
            {...enter(0.32)}
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed opacity-70 sm:text-lg lg:mx-0"
          >
            Isabela State University’s centralized, AI-assisted research library.
            Ask in plain language — get AI-synthesized answers grounded exclusively in the
            approved campus collections, with traceable citations and decision-support for
            related or potentially overlapping topics.
          </motion.p>

          {/* Typewriter "ask the archive" mock input → guest chat */}
          <motion.div {...enter(0.44)}>
            <motion.button
              type="button"
              onClick={() => navigate('/chat')}
              aria-label="Try asking the archive — open guest chat"
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.99 }}
              className="glass-strong group mx-auto mt-9 flex w-full max-w-xl cursor-pointer items-center gap-3 rounded-2xl px-4 py-3.5 text-left lg:mx-0"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800">
                <Sparkles size={15} className="text-gold-300" />
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[0.8rem] opacity-85 sm:text-sm">
                <TypewriterText phrases={ASK_PHRASES} />
              </span>
              <span className="shrink-0 rounded-xl bg-gradient-to-br from-gold-300 to-gold-400 px-3.5 py-1.5 text-xs font-bold text-forest-950 shadow-lg shadow-gold-400/25 transition-transform duration-300 group-hover:scale-105">
                Ask
              </span>
            </motion.button>
          </motion.div>

          {/* CTA pair */}
          <motion.div
            {...enter(0.56)}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start"
          >
            <Magnetic>
              <Button size="xl" variant="gold" onClick={() => navigate('/login')} className="group">
                Get started free
                <ArrowRight
                  size={17}
                  className="transition-transform duration-300 group-hover:translate-x-1"
                />
              </Button>
            </Magnetic>
            <Magnetic strength={0.2}>
              <Button size="xl" variant="secondary" onClick={() => navigate('/chat')}>
                <MessageSquareText size={18} />
                Explore as Guest Researcher
              </Button>
            </Magnetic>
          </motion.div>

          {/* Trust chips */}
          <motion.div
            {...enter(0.68)}
            className="mt-9 flex flex-wrap items-center justify-center gap-2.5 lg:justify-start"
          >
            {TRUST_CHIPS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="glass-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.7rem] font-semibold opacity-80"
              >
                <Icon size={12} className="text-gold-500 dark:text-gold-300" />
                {label}
              </span>
            ))}
          </motion.div>
        </motion.div>

        {/* Right column is intentionally empty — the orb lives in the absolute
            canvas layer behind it. */}
        <div className="hidden lg:block" aria-hidden="true" />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6 }}
        className="absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1 text-xs opacity-40"
      >
        Scroll to explore
        <ChevronDown size={16} className="animate-bounce" />
      </motion.div>
    </section>
  )
}
