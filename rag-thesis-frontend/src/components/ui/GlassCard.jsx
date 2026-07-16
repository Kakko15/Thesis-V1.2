import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'
import { usePreferences } from '../../context/PreferencesContext'

/**
 * Material 3 glass surface. `hover` adds a lift + glow micro-interaction.
 */
export function GlassCard({ className, children, hover = false, strong = false, ...props }) {
  const { effects, reducedMotion } = usePreferences()
  const interactiveMotion = hover && effects !== 'low' && !reducedMotion
  return (
    <motion.div
      whileHover={
        interactiveMotion
          ? { y: -4, transition: { type: 'spring', stiffness: 300, damping: 22 } }
          : undefined
      }
      className={cn(
        strong ? 'surface-glass shadow-2xl' : 'surface-glass',
        'rounded-[1.5rem] transition-shadow duration-500',
        interactiveMotion && 'hover:shadow-[0_20px_60px_rgb(var(--shadow-color)/0.18)]',
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  )
}
