import { AnimatePresence, motion } from 'framer-motion'
import { Check, Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'

/* Shared micro-interaction vocabulary for the auth flow, so every step
   speaks the same motion language: cascading field entrances, hover shine
   sweeps, error shakes and validity ticks. */

export const EASE = [0.2, 0, 0, 1]

/** Parent/child variants — fields cascade in as each step mounts. */
export const formStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
}
export const fieldRise = {
  hidden: { opacity: 0, y: 14, filter: 'blur(3px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE } },
}

/** Cascade item pre-wired with the rise variants (use inside formStagger). */
export function Rise({ className, children, ...props }) {
  return (
    <motion.div variants={fieldRise} className={className} {...props}>
      {children}
    </motion.div>
  )
}

/** One-shot hover shine — drop inside a `relative overflow-hidden group` Button. */
export function Shine({ strong = false }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 w-2/5 -translate-x-[150%] skew-x-[-18deg]',
        'bg-gradient-to-r from-transparent to-transparent group-hover:animate-sweep',
        strong ? 'via-white/40' : 'via-white/25',
      )}
    />
  )
}

/** Form-level error with a slide-in + shake, matching the OTP boxes. */
export function ErrorAlert({ children, className }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, x: [0, -7, 7, -4, 4, 0] }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      role="alert"
      aria-live="polite"
      className={cn(
        'rounded-xl bg-flame-500/10 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-flame-600 dark:text-flame-400',
        className,
      )}
    >
      {children}
    </motion.p>
  )
}

/** Green check that pops in at the input's right edge once the value is valid. */
export function ValidTick({ show, className }) {
  return (
    <span className={cn('pointer-events-none absolute right-4 top-1/2 -translate-y-1/2', className)}>
      <AnimatePresence>
        {show && (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-forest-500 text-white shadow-sm shadow-forest-500/40"
          >
            <Check size={11} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/** Leading field icon that lights up while its input has focus.
    The wrapping element must carry `group relative`. */
export function FieldIcon({ icon: Icon }) {
  return (
    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40 transition-all duration-300 group-focus-within:scale-110 group-focus-within:text-forest-600 group-focus-within:opacity-100 dark:group-focus-within:text-forest-300">
      <Icon size={16} />
    </span>
  )
}

/** Show/hide password toggle with a micro morph between eye states. */
export function PasswordEye({ show, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'Hide password' : 'Show password'}
      aria-pressed={show}
      className="absolute right-4 top-1/2 -translate-y-1/2 opacity-40 transition-opacity hover:opacity-90 focus-visible:opacity-90"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={show ? 'off' : 'on'}
          initial={{ opacity: 0, y: 5, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -5, scale: 0.85 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="block"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** Text link with an animated underline that grows from the left. */
export function UnderlineLink({ as: Tag = 'button', className, children, ...props }) {
  return (
    <Tag
      {...(Tag === 'button' ? { type: 'button' } : {})}
      className={cn(
        'relative font-semibold transition-colors',
        'after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-full after:origin-left after:scale-x-0 after:bg-current after:transition-transform after:duration-300 hover:after:scale-x-100',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}
