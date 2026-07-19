import { motion } from 'framer-motion'
import { usePreferences } from '../../context/PreferencesContext'
import { cn } from '../../lib/utils'

const DOT_EASE = [0.4, 0, 0.2, 1]

export function LogoActivityDots({ className }) {
  const { reducedMotion, effects } = usePreferences()
  const animated = !reducedMotion && effects !== 'low'

  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center gap-1', className)}
    >
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="block h-1.5 w-1.5 rounded-full bg-gold-300 shadow-[0_0_9px_rgba(255,199,44,0.65)]"
          animate={animated ? {
            y: [0, -3.5, 0],
            scale: [0.78, 1.12, 0.78],
            opacity: [0.5, 1, 0.5],
          } : { y: 0, scale: 1, opacity: 0.9 }}
          transition={animated ? {
            duration: 1.45,
            delay: index * 0.16,
            repeat: Infinity,
            ease: DOT_EASE,
          } : { duration: 0 }}
          style={{ willChange: animated ? 'transform, opacity' : 'auto' }}
        />
      ))}
    </span>
  )
}
