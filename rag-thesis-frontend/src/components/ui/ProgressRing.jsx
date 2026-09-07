import { motion } from 'framer-motion'
import { AnimatedCounter } from './Motion'
import { cn } from '../../lib/utils'

/** The default sweep: slow and deliberate, for a one-shot similarity reveal. */
const REVEAL_TRANSITION = { duration: 1.4, ease: [0.2, 0, 0, 1], delay: 0.2 }

/**
 * Animated SVG similarity/percentage gauge.
 *
 * By default the color shifts from ISU forest (safe) through gold (caution) to
 * flame (high), which reads correctly for a duplication score where a high
 * number is bad. Callers where a high number is *good* — upload progress —
 * pass `color` to opt out, and `transition` to shorten the sweep when the value
 * is re-targeted on every status poll rather than revealed once.
 */
export function ProgressRing({
  value = 0, size = 140, strokeWidth = 11, label, color, transition = REVEAL_TRANSITION, className,
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  const stroke = color ?? (clamped >= 60 ? '#d22630' : clamped >= 30 ? '#f2a900' : '#059656')

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          className="stroke-forest-900/10 dark:stroke-white/10"
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (clamped / 100) * circumference }}
          transition={transition}
          style={{ filter: `drop-shadow(0 0 8px ${stroke}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-extrabold" style={{ color: stroke }}>
          <AnimatedCounter value={clamped} suffix="%" />
        </span>
        {label && <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</span>}
      </div>
    </div>
  )
}
