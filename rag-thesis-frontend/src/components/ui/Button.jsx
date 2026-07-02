import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const variants = {
  primary:
    'bg-gradient-to-br from-forest-600 to-forest-800 text-white shadow-lg shadow-forest-900/25 hover:shadow-forest-700/40 hover:brightness-110',
  gold:
    'bg-gradient-to-br from-gold-300 to-gold-400 text-forest-950 shadow-lg shadow-gold-400/25 hover:shadow-gold-400/45 hover:brightness-105 font-semibold',
  secondary:
    'glass text-forest-800 dark:text-ivory-100 hover:bg-white/80 dark:hover:bg-white/10',
  ghost:
    'text-forest-700 dark:text-ivory-200 hover:bg-forest-900/8 dark:hover:bg-white/8',
  danger:
    'bg-gradient-to-br from-flame-500 to-flame-600 text-white shadow-lg shadow-flame-600/25 hover:brightness-110',
  outline:
    'border border-forest-700/30 dark:border-white/20 text-forest-800 dark:text-ivory-100 hover:bg-forest-900/5 dark:hover:bg-white/8',
}

const sizes = {
  sm: 'h-8 px-3.5 text-xs gap-1.5 rounded-xl',
  md: 'h-10 px-5 text-sm gap-2 rounded-2xl',
  lg: 'h-12 px-7 text-base gap-2.5 rounded-2xl',
  xl: 'h-14 px-9 text-base gap-3 rounded-[1.25rem]',
  icon: 'h-10 w-10 rounded-2xl',
  'icon-sm': 'h-8 w-8 rounded-xl',
}

export const Button = forwardRef(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium outline-none transition-all duration-300',
        'focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  )
})
