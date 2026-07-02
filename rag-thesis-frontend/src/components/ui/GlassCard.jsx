import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

/**
 * Material 3 glass surface. `hover` adds a lift + glow micro-interaction.
 */
export function GlassCard({ className, children, hover = false, strong = false, ...props }) {
  return (
    <motion.div
      whileHover={
        hover
          ? { y: -4, transition: { type: 'spring', stiffness: 300, damping: 22 } }
          : undefined
      }
      className={cn(
        strong ? 'glass-strong' : 'glass',
        'rounded-[1.5rem] transition-shadow duration-500',
        hover && 'hover:shadow-[0_20px_60px_rgba(4,106,56,0.18)] dark:hover:shadow-[0_20px_60px_rgba(16,185,108,0.12)]',
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  )
}
