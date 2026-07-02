import { motion, useInView, useSpring, useTransform } from 'framer-motion'
import { useEffect, useRef } from 'react'

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
