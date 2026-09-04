import { useId } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, Timer } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  passwordStrength, PASSWORD_RULES, STRENGTH_COLORS, STRENGTH_LABELS,
} from './authUtils'

/* Shared micro-interaction vocabulary for the auth flow, so every step
   speaks the same motion language: cascading field entrances, hover shine
   sweeps, error shakes and validity ticks. */

export const EASE = [0.2, 0, 0, 1]

/** Parent/child variants — fields cascade in as each step mounts. */
/* Kept brisk on purpose: this cascade replays on every tab switch, so a long
   per-field duration compounds with the step transition and the card reads as
   slow to appear rather than considered. */
export const formStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0 } },
}
export const fieldRise = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE } },
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

/**
 * Rate-limit pause card: a countdown ring whose arc depletes second by
 * second (digits flip as they tick), plus a flame→gold hairline draining at
 * the card's foot. Enters with the same shake as ErrorAlert so the feedback
 * reads as one language. The caller disables the form while `seconds > 0`.
 */
export function RateLimitAlert({ seconds, total, className }) {
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const progress = total > 0 ? seconds / total : 0
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: [0, -7, 7, -4, 4, 0] }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      role="alert"
      aria-live="polite"
      className={cn(
        'overflow-hidden rounded-2xl border border-flame-500/25 bg-flame-500/8 dark:bg-flame-500/10',
        className,
      )}
    >
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          <svg viewBox="0 0 48 48" aria-hidden="true" className="h-12 w-12 -rotate-90">
            <circle
              cx="24" cy="24" r={radius} fill="none" strokeWidth="4"
              className="stroke-flame-500/15"
            />
            <motion.circle
              cx="24" cy="24" r={radius} fill="none" strokeWidth="4" strokeLinecap="round"
              className="stroke-flame-500"
              strokeDasharray={circumference}
              initial={false}
              animate={{ strokeDashoffset: circumference * (1 - progress) }}
              transition={{ duration: 0.9, ease: 'linear' }}
            />
          </svg>
          <span className="absolute font-mono text-sm font-bold tabular-nums text-flame-600 dark:text-flame-400">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={seconds}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="block"
              >
                {seconds}
              </motion.span>
            </AnimatePresence>
          </span>
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-bold text-flame-600 dark:text-flame-400">
            <Timer size={14} aria-hidden="true" /> Too many attempts
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-flame-600/80 dark:text-flame-400/80">
            Sign-in is paused to protect this account. It unlocks automatically
            when the timer ends — no need to keep trying.
          </span>
        </span>
      </div>
      <div aria-hidden="true" className="h-[3px] bg-flame-500/12">
        <motion.div
          initial={false}
          animate={{ scaleX: progress }}
          transition={{ duration: 0.9, ease: 'linear' }}
          className="h-full origin-left bg-gradient-to-r from-flame-500 to-gold-400"
        />
      </div>
    </motion.div>
  )
}

/** Google Fonts (Material Symbols Outlined, fill 0 / wght 400 / opsz 24)
    glyphs as inline SVG — the exact official paths, without shipping a
    webfont for two icons. */
const GOOGLE_ICON_VIEWBOX = '0 -960 960 960'
const GOOGLE_ICON_PATHS = {
  checkCircle:
    'm424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
  circle:
    'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z',
}

export function GoogleIcon({ name, size = 20, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={GOOGLE_ICON_VIEWBOX}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d={GOOGLE_ICON_PATHS[name]} />
    </svg>
  )
}

/** Green check that pops in at the input's right edge once the value is valid. */
export function ValidTick({ show, className }) {
  return (
    <span className={cn('pointer-events-none absolute right-4 top-1/2 -translate-y-1/2', className)}>
      <AnimatePresence>
        {show && (
          <motion.span
            initial={{ scale: 0.3, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0, rotate: 30 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22, mass: 0.7 }}
            className="block text-forest-500"
          >
            <GoogleIcon name="checkCircle" size={19} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

const FLOAT_EASE = 'ease-[cubic-bezier(0.2,0,0,1)]'
// Geometry shared by the two float triggers (focus and filled), so both
// states animate identically. Only `translate` and `scale` move — both are
// GPU-composited, so the glide never triggers layout and stays butter-smooth.
// The label is anchored at the field's vertical centre with origin-left:
// at rest it renders full-size; floated it rides 0.75rem up and shrinks to
// 75% (16px → 12px) around its own centre.
const FLOAT_TRIGGERS = [
  'peer-focus:-translate-y-[calc(50%_+_0.75rem)] peer-focus:scale-75',
  'peer-[:not(:placeholder-shown)]:-translate-y-[calc(50%_+_0.75rem)] peer-[:not(:placeholder-shown)]:scale-75',
]

/**
 * Google-style outlined field: the label rests inside the box like a
 * placeholder, then floats into the top corner on focus or once filled.
 * Pure CSS via the `peer` + `:placeholder-shown` trick, so it works with
 * controlled and uncontrolled inputs with no extra state. The label carries
 * no background of its own — the field interior is one uniform surface, so
 * no patch (or visible rectangle) is ever needed.
 */
export function FloatingField({
  label,
  error,
  hint,
  endAdornment,
  required,
  className,
  id,
  placeholder = ' ',
  ...inputProps
}) {
  const generatedId = useId()
  const fieldId = id || generatedId

  return (
    <div className={className}>
      <div className="group relative">
        <input
          id={fieldId}
          placeholder={placeholder}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            // --surface-0, not --surface-1: the auth card already sits on a
            // tinted glass panel, so the darker step read as a filled grey
            // block instead of an input interior.
            'peer h-14 w-full rounded-2xl border bg-[var(--surface-0)] px-4 pb-2 pt-6 text-base text-[var(--foreground)] caret-[var(--primary)] outline-none',
            `transition-[border-color,box-shadow,background-color] duration-300 ${FLOAT_EASE}`,
            endAdornment && 'pr-11',
            error
              ? 'border-[var(--destructive)] focus:shadow-[inset_0_0_0_1px_var(--destructive)]'
              : 'border-[var(--input)] hover:border-forest-900/40 focus:border-[var(--primary)] focus:shadow-[inset_0_0_0_1px_var(--primary)] dark:hover:border-white/30',
          )}
          {...inputProps}
        />
        <label
          htmlFor={fieldId}
          className={cn(
            'pointer-events-none absolute left-4 top-1/2 max-w-[calc(100%-2rem)] origin-left -translate-y-1/2 select-none truncate text-base text-[var(--muted-foreground)] will-change-transform',
            `transition-[translate,scale,color] duration-300 ${FLOAT_EASE}`,
            ...FLOAT_TRIGGERS,
            error
              ? 'peer-focus:text-flame-600 dark:peer-focus:text-flame-400'
              : 'peer-focus:text-forest-700 dark:peer-focus:text-forest-300',
          )}
        >
          {label}
          {required && <span className="text-flame-500"> *</span>}
        </label>
        {endAdornment}
      </div>
      <AnimatePresence initial={false}>
        {(error || hint) && (
          <motion.div
            key={error ? 'error' : 'hint'}
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <span
              className={cn(
                'block pt-1.5 text-xs',
                error ? 'font-medium text-flame-500' : 'text-ink-faint',
              )}
            >
              {error || hint}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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

// Pill tone per strength level — pairs with STRENGTH_COLORS used for the bar.
const STRENGTH_PILL = [
  'bg-flame-500/10 text-flame-600 dark:text-flame-400',
  'bg-flame-500/10 text-flame-600 dark:text-flame-400',
  'bg-gold-400/15 text-gold-700 dark:text-gold-300',
  'bg-forest-500/10 text-forest-700 dark:text-forest-300',
  'bg-forest-500/10 text-forest-700 dark:text-forest-300',
]

/**
 * Live password guide: a hairline meter that sweeps smoothly with a tinted
 * strength pill at its end, and a quiet two-column checklist whose circular
 * ticks fill in as each rule starts passing. Collapses smoothly away while
 * the field is empty.
 */
export function PasswordGuide({ password }) {
  const strength = passwordStrength(password)
  return (
    <AnimatePresence initial={false}>
      {password && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2.5 pt-2.5">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink-faint/15">
              <motion.div
                initial={false}
                animate={{ scaleX: strength / PASSWORD_RULES.length }}
                transition={{ duration: 0.5, ease: EASE }}
                style={{ transformOrigin: 'left' }}
                className={cn(
                  'h-full w-full rounded-full transition-colors duration-300',
                  STRENGTH_COLORS[strength],
                )}
              />
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={strength}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.2, ease: EASE }}
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors duration-300',
                  STRENGTH_PILL[strength],
                )}
              >
                {STRENGTH_LABELS[strength]}
              </motion.span>
            </AnimatePresence>
          </div>

          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password)
              return (
                <li key={rule.key} className="flex items-center gap-1.5">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={ok ? 'met' : 'unmet'}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      aria-hidden="true"
                      className={cn(
                        'block shrink-0 transition-colors duration-300',
                        ok ? 'text-forest-500' : 'text-ink-faint/50',
                      )}
                    >
                      <GoogleIcon name={ok ? 'checkCircle' : 'circle'} size={13} />
                    </motion.span>
                  </AnimatePresence>
                  <span
                    className={cn(
                      'text-[11px] font-medium transition-colors duration-300',
                      ok ? 'text-forest-700 dark:text-forest-300' : 'text-ink-faint',
                    )}
                  >
                    {rule.label}
                  </span>
                </li>
              )
            })}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Text link with an animated underline that grows from the left. */
export function UnderlineLink({ as: Tag = 'button', className, children, ...props }) {  return (
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
