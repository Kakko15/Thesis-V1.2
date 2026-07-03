import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { EASE } from './AuthFx'

/** Icon badge + title/subtitle lockup shared by every auth step.
    The badge springs in with a gold ring ripple; copy follows staggered. */
export function StepHeader({ icon: Icon, title, subtitle, onBack, backLabel = 'Back' }) {
  return (
    <div className="mb-7">
      {onBack && (
        <motion.button
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          type="button"
          onClick={onBack}
          className="group mb-5 inline-flex items-center gap-1.5 text-xs font-semibold opacity-50 transition-opacity hover:opacity-100"
        >
          <ArrowLeft size={13} className="transition-transform duration-300 group-hover:-translate-x-0.5" />
          {backLabel}
        </motion.button>
      )}
      <div className="flex items-start gap-4">
        <motion.div
          initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 20, delay: 0.05 }}
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25"
        >
          <motion.span
            aria-hidden="true"
            initial={{ opacity: 0.7, scale: 1 }}
            animate={{ opacity: 0, scale: 1.45 }}
            transition={{ duration: 0.9, delay: 0.25, ease: 'easeOut' }}
            className="absolute inset-0 rounded-2xl border-2 border-gold-400/60"
          />
          <Icon size={21} className="text-gold-300" />
        </motion.div>
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="font-display text-xl font-extrabold tracking-tight sm:text-2xl"
          >
            {title}
          </motion.h1>
          {subtitle && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.18, ease: EASE }}
              className="mt-1 text-sm leading-relaxed opacity-60"
            >
              {subtitle}
            </motion.p>
          )}
        </div>
      </div>
    </div>
  )
}
