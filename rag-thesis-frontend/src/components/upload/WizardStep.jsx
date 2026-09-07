import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../lib/utils'
import { motionTokens } from '../../design/motion'
import { useAutoHeight } from './useAutoHeight'

const { duration, easing, spring } = motionTokens

/**
 * Direction-aware step surfaces. `direction` is +1 forward, -1 back, so Back
 * reverses the push instead of replaying the forward slide — the wizard used
 * one hardcoded literal for both and the spatial model came apart.
 */
const stepVariants = {
  enter: (direction) => ({ opacity: 0, x: direction * 28, filter: 'blur(5px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)' },
  // The exit carries its own short, non-spring transition: `mode="wait"` holds
  // the incoming pane until this one finishes, and a spring has no fixed end,
  // so leaving it on the shared transition made every advance feel stalled.
  exit: (direction) => ({
    opacity: 0,
    x: direction * -28,
    filter: 'blur(5px)',
    transition: { duration: 0.16, ease: easing.exit },
  }),
}

// A softer spring than motionTokens.spring: tall content overshooting its own
// height is far more noticeable than a control overshooting its position.
const heightSpring = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }

/**
 * `mode="wait"` rather than `popLayout`, deliberately. Overlapping the panes
 * would briefly mount two copies of the same manuscript title and category,
 * which is a Playwright strict-mode violation for the review-step `getByText`
 * assertions — and the smoothness comes from the height spring below, not from
 * the overlap. The exit is kept short so the handover still reads as one move.
 */
export function WizardStep({ stepKey, direction, className, children }) {
  const [measuredRef, height] = useAutoHeight()
  const [clipping, setClipping] = useState(false)

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={heightSpring}
      // Clip only while the height is actually travelling. Left hidden at rest
      // it would shave the 3px focus ring off every full-width input; driven
      // off the animation's own lifecycle rather than an effect, so a step
      // whose height happens not to change never clips at all.
      onAnimationStart={() => setClipping(true)}
      onAnimationComplete={() => setClipping(false)}
      style={{ overflow: clipping ? 'hidden' : 'visible' }}
    >
      <div ref={measuredRef}>
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={stepKey}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: spring,
              opacity: { duration: duration.short, ease: easing.standard },
              filter: { duration: duration.short, ease: easing.standard },
            }}
            className={cn('min-w-0', className)}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
