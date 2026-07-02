import { useEffect } from 'react'
import { motion } from 'framer-motion'

/** Animated checkmark, then hands control back (navigate). */
export function SuccessStep({ title = 'You’re in!', subtitle, onDone, delay = 1200 }) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), delay)
    return () => clearTimeout(t)
  }, [onDone, delay])

  return (
    <div className="py-6 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-forest-500/15 to-gold-400/15"
      >
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
          <motion.circle
            cx="22"
            cy="22"
            r="19"
            stroke="url(#success-grad)"
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
          />
          <motion.path
            d="M13.5 22.5 L19.5 28.5 L30.5 16.5"
            stroke="url(#success-grad)"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.45, duration: 0.4, ease: [0.2, 0, 0, 1] }}
          />
          <defs>
            <linearGradient id="success-grad" x1="0" y1="0" x2="44" y2="44">
              <stop stopColor="#10b96c" />
              <stop offset="1" stopColor="#f2a900" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.2, 0, 0, 1] }}
        className="font-display text-2xl font-extrabold tracking-tight"
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.5, ease: [0.2, 0, 0, 1] }}
          className="mt-2 text-sm opacity-60"
        >
          {subtitle}
        </motion.p>
      )}
    </div>
  )
}
