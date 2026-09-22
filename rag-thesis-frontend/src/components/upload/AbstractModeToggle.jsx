import { useId } from 'react'
import { motion } from 'framer-motion'
import { BookText, Loader2, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import {
  ABSTRACT_MODES, ABSTRACT_MODE_COPY, ABSTRACT_MODE_ORDER,
} from '../../pages/upload/abstractMode'

const ICONS = {
  [ABSTRACT_MODES.document]: BookText,
  [ABSTRACT_MODES.extended]: Sparkles,
}

/**
 * Which abstract the manuscript step autofills: the one printed in the PDF, or
 * a longer one Gemini writes from it.
 *
 * It sits on step 1 rather than beside the field on step 2 because that is
 * where the decision has consequences. Step 1 is the step that reads the
 * manuscript, and the extended setting spends a generation over 28 pages of
 * it: offering that choice next to the textarea would mean the uploader
 * meets it after the wizard has already answered the question.
 *
 * A segmented control and not a switch, because neither setting is "off" and
 * neither is a more-of-the-same version of the other -- one is the thesis's
 * own words and one is a model's. The sliding pill is the selection; the
 * labels are legible without it, and it never moves under a screen reader
 * (the radios are the state).
 */
export function AbstractModeToggle({ mode, onChange, busy = false, disabled = false }) {
  const name = useId()
  const hint = ABSTRACT_MODE_COPY[mode]?.hint

  return (
    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/70 p-3 shadow-xs backdrop-blur-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
          Abstract
        </span>

        <div
          role="radiogroup"
          aria-label="Which abstract to autofill"
          className="relative ml-auto inline-flex rounded-full bg-forest-900/6 p-0.5 dark:bg-white/8"
        >
          {ABSTRACT_MODE_ORDER.map((value) => {
            const Icon = ICONS[value]
            const active = value === mode
            const pending = busy && active && value === ABSTRACT_MODES.extended
            return (
              <label
                key={value}
                className={cn(
                  'relative z-10 flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5',
                  'text-xs font-semibold transition-colors duration-200',
                  'focus-within:shadow-[0_0_0_2px_var(--ring)]',
                  active ? 'text-white dark:text-forest-950' : 'text-ink-muted hover:text-ink',
                  (disabled || busy) && 'cursor-not-allowed opacity-70',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={value}
                  checked={active}
                  disabled={disabled || busy}
                  onChange={() => onChange?.(value)}
                  // Transparent and covering its whole segment, rather than
                  // `sr-only`: an sr-only input is a 1px box behind the icon,
                  // so a pointer landing on the segment hits the icon and the
                  // radio never receives the click. Positioned, so it paints
                  // above the static icon and label beside it.
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                {active && (
                  <motion.span
                    layoutId={`${name}-pill`}
                    transition={motionTokens.spring}
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-forest-600 to-forest-800 shadow-sm dark:from-gold-300 dark:to-gold-500"
                  />
                )}
                {pending
                  ? <Loader2 size={13} aria-hidden="true" className="animate-spin" />
                  : <Icon size={13} aria-hidden="true" />}
                {ABSTRACT_MODE_COPY[value].label}
              </label>
            )
          })}
        </div>
      </div>

      {/* aria-live, because the copy below is the only thing that changes for a
          reader who cannot see the pill move -- and when the generation fails
          the control snaps back here rather than where they left it. */}
      <p aria-live="polite" className="mt-2 text-[11px] leading-relaxed text-ink-muted">
        {busy
          ? 'Reading the manuscript and writing the extended abstract…'
          : hint}
      </p>
    </div>
  )
}
