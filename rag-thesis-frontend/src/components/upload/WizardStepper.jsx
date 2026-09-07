import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'
import { stepInteraction } from '../../pages/upload/wizardSteps'

// Stiffer than the shared token: this indicator travels a short distance and
// should arrive before the pane it describes.
const indicatorSpring = { type: 'spring', stiffness: 380, damping: 32, mass: 0.7 }
const fillTransition = { duration: 0.45, ease: [0.2, 0, 0, 1] }

function StepNode({ state, index, layoutGroup }) {
  return (
    <span
      className={cn(
        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-bold',
        'transition-colors duration-300',
        state === 'done' && 'bg-forest-600 text-white',
        state === 'current' && 'text-forest-950',
        // Was `glass opacity-50`, which halves the contrast of the numeral
        // along with the chip. An explicit tonal surface keeps the text role
        // at its audited ratio — see the note on --color-ink-* in index.css.
        state === 'upcoming' && 'border border-[var(--border)] bg-[var(--surface-2)] text-ink-faint',
      )}
    >
      {state === 'current' && (
        <motion.span
          layoutId={`${layoutGroup}-active`}
          transition={indicatorSpring}
          aria-hidden="true"
          className="absolute inset-0 rounded-2xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/30"
        />
      )}
      <span className="relative">
        {state === 'done' ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : index + 1}
      </span>
    </span>
  )
}

function Connector({ filled, vertical }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'overflow-hidden rounded-full bg-[var(--border)]',
        vertical
          ? 'absolute bottom-0 left-[1.125rem] top-9 w-0.5 -translate-x-1/2'
          : 'mx-2 mt-[1.0625rem] h-0.5 w-10 shrink-0 sm:mx-3 sm:w-16',
      )}
    >
      <motion.span
        className={cn('block h-full w-full rounded-full bg-forest-600', vertical ? 'origin-top' : 'origin-left')}
        initial={false}
        animate={vertical ? { scaleY: filled ? 1 : 0 } : { scaleX: filled ? 1 : 0 }}
        transition={fillTransition}
      />
    </span>
  )
}

/**
 * The wizard progress indicator, shared by the single-upload rail (vertical)
 * and the batch page's header (horizontal).
 *
 * A step renders as a button only when `onSelect` is supplied *and* the wizard
 * has already moved past it. Playwright matches accessible names as
 * case-insensitive substrings and no upload assertion passes `exact: true`, so
 * a focusable node named "Review" living alongside the metadata step's footer
 * "Review" button would make `getByRole` ambiguous. See `stepInteraction`.
 */
export function WizardStepper({ steps, current, orientation = 'horizontal', onSelect, className }) {
  const vertical = orientation === 'vertical'
  const layoutGroup = vertical ? 'wizard-rail' : 'wizard-strip'

  return (
    <ol className={cn(vertical ? 'flex flex-col' : 'flex items-start justify-center', className)}>
      {steps.map((step, index) => {
        const state = stepInteraction(index, current)
        const last = index === steps.length - 1
        const interactive = state === 'done' && Boolean(onSelect)
        const Element = interactive ? 'button' : 'div'

        const body = (
          <Element
            type={interactive ? 'button' : undefined}
            onClick={interactive ? () => onSelect(index) : undefined}
            // "Return to", not "Go back to": accessible names match as
            // substrings, so a rail node named "…back…" collided with the
            // footer's own "Back" button — three buttons answered to the name
            // on the review step. Keep the visible label inside the name
            // (WCAG 2.5.3) without repeating any other control's name.
            aria-label={interactive ? `Return to the ${step.label.toLowerCase()} step` : undefined}
            className={cn(
              'group relative flex outline-none',
              vertical
                ? 'w-full items-start gap-3 rounded-2xl px-2 py-1.5 text-left'
                : 'flex-col items-center gap-1.5',
              interactive && 'cursor-pointer transition-colors duration-200 hover:bg-[var(--accent)]',
            )}
          >
            <StepNode state={state} index={index} layoutGroup={layoutGroup} />
            <span className={cn('min-w-0', vertical && 'pt-1.5')}>
              <span
                className={cn(
                  'block text-xs font-semibold uppercase tracking-wider transition-colors duration-300',
                  state === 'upcoming' ? 'text-ink-faint' : 'text-ink',
                )}
              >
                {step.label}
              </span>
              {vertical && step.hint && (
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">{step.hint}</span>
              )}
            </span>
          </Element>
        )

        return (
          <li
            key={step.key ?? step.label}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(vertical ? 'relative' : 'flex items-start', vertical && !last && 'pb-6')}
          >
            {vertical && !last && <Connector filled={index < current} vertical />}
            {body}
            {!vertical && !last && <Connector filled={index < current} vertical={false} />}
          </li>
        )
      })}
    </ol>
  )
}
