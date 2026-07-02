import { motion, useInView, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

/** Route-level page transition wrapper. */
export function PageTransition({ children, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }}
      transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Scroll-triggered reveal (fires once). */
export function Reveal({ children, delay = 0, y = 28, className, once = true }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-80px' }}
      transition={{ duration: 0.7, delay, ease: [0.2, 0, 0, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Staggered container + item helpers. */
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
}
export const staggerItem = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.2, 0, 0, 1] } },
}

/** Spring-animated number counter. */
export function AnimatedCounter({ value, className, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const spring = useSpring(0, { stiffness: 60, damping: 18 })
  const display = useTransform(spring, (v) => `${Math.round(v).toLocaleString()}${suffix}`)

  useEffect(() => {
    if (inView) spring.set(value || 0)
  }, [inView, value, spring])

  return <motion.span ref={ref} className={className}>{display}</motion.span>
}

/** Looping type/delete text cycler with a blinking caret. */
export function TypewriterText({ phrases, typingSpeed = 45, deleteSpeed = 22, pause = 1800, className }) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState('')
  const state = useRef({ phrase: 0, char: 0, deleting: false })

  useEffect(() => {
    if (reduced || !phrases?.length) return undefined
    let timer
    const tick = () => {
      const s = state.current
      const current = phrases[s.phrase % phrases.length]
      if (!s.deleting) {
        s.char += 1
        setDisplay(current.slice(0, s.char))
        if (s.char >= current.length) {
          s.deleting = true
          timer = setTimeout(tick, pause)
        } else {
          timer = setTimeout(tick, typingSpeed)
        }
      } else {
        s.char -= 1
        setDisplay(current.slice(0, s.char))
        if (s.char <= 0) {
          s.deleting = false
          s.phrase += 1
          timer = setTimeout(tick, typingSpeed * 4)
        } else {
          timer = setTimeout(tick, deleteSpeed)
        }
      }
    }
    timer = setTimeout(tick, typingSpeed)
    return () => clearTimeout(timer)
  }, [phrases, typingSpeed, deleteSpeed, pause, reduced])

  if (reduced || !phrases?.length) return <span className={className}>{phrases?.[0] ?? ''}</span>
  return (
    <span className={className}>
      <span className="sr-only">{phrases[0]}</span>
      <span aria-hidden="true">
        {display}
        <span className="animate-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-gold-400" />
      </span>
    </span>
  )
}

/** Wrapper that magnetically pulls its child toward the cursor. */
export function Magnetic({ children, strength = 0.3, className }) {
  const reduced = useReducedMotion()
  const ref = useRef(null)
  const x = useSpring(0, { stiffness: 180, damping: 14 })
  const y = useSpring(0, { stiffness: 180, damping: 14 })

  const onPointerMove = (e) => {
    if (reduced) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    x.set((e.clientX - (rect.left + rect.width / 2)) * strength)
    y.set((e.clientY - (rect.top + rect.height / 2)) * strength)
  }
  const reset = () => {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.div
      ref={ref}
      style={{ x, y }}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      className={cn('inline-block', className)}
    >
      {children}
    </motion.div>
  )
}

/** Pointer-tracked 3D tilt with an optional glare sheen. */
export function TiltCard({ children, max = 9, glare = true, className }) {
  const reduced = useReducedMotion()
  const ref = useRef(null)
  const rx = useSpring(0, { stiffness: 220, damping: 18 })
  const ry = useSpring(0, { stiffness: 220, damping: 18 })
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const disabled = reduced || coarse

  const onPointerMove = (e) => {
    if (disabled) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    ry.set((px - 0.5) * 2 * max)
    rx.set(-(py - 0.5) * 2 * max)
    ref.current.style.setProperty('--px', `${px * 100}%`)
    ref.current.style.setProperty('--py', `${py * 100}%`)
  }
  const reset = () => {
    rx.set(0)
    ry.set(0)
  }

  return (
    <motion.div
      ref={ref}
      style={disabled ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      className={cn('group relative h-full will-change-transform', className)}
    >
      {children}
      {glare && !disabled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[1.5rem] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(420px circle at var(--px, 50%) var(--py, 50%), rgba(255,255,255,0.10), transparent 60%)',
          }}
        />
      )}
    </motion.div>
  )
}

/** Card wrapper with a cursor-following radial spotlight glow. */
export function SpotlightCard({ children, className }) {
  const ref = useRef(null)
  const onPointerMove = (e) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    ref.current.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    ref.current.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
  }
  return (
    <div ref={ref} onPointerMove={onPointerMove} className={cn('group relative h-full', className)}>
      {children}
      <div aria-hidden="true" className="spotlight-overlay rounded-[1.5rem]" />
    </div>
  )
}

/** Seamless duplicated-row marquee. `render(item, i)` draws one chip. */
export function MarqueeRow({ items, render, reverse = false, slow = false, className }) {
  const half = (hidden) => (
    <div aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-4 pr-4">
      {items.map((item, i) => (
        <div key={i} className="shrink-0">
          {render(item, i)}
        </div>
      ))}
    </div>
  )
  return (
    <div className={cn('mask-fade-x overflow-hidden', className)}>
      <div
        className={cn(
          'flex w-max hover:[animation-play-state:paused]',
          slow ? 'animate-marquee-slow' : 'animate-marquee',
          reverse && '[animation-direction:reverse]',
        )}
      >
        {half(false)}
        {half(true)}
      </div>
    </div>
  )
}
