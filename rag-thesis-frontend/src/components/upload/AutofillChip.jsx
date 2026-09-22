import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { motionTokens } from '../../design/motion'

const { duration, easing } = motionTokens

/**
 * The extraction step fills the form silently, so a reader had no way to tell
 * an autofilled value from one they typed — the difference that decides
 * whether a field needs checking. The marker disappears on first edit.
 *
 * Deliberately quiet: this was a filled `Badge`, and three of them down the
 * Identity column carried more weight than the labels they annotated. It is a
 * footnote on a value, not a status worth a pill.
 *
 * Its own module because both `MetadataForm`'s field labels and
 * `AbstractField`'s header use it, and importing it from the former into the
 * latter would close an import cycle.
 */
export function AutofillChip({ show }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          initial={{ opacity: 0, scale: 0.85, y: -2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -2 }}
          transition={{ duration: duration.short, ease: easing.standard }}
          className="inline-flex items-center gap-1 rounded-full bg-gold-400/15 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-gold-700 dark:text-gold-300 border border-gold-400/30 shadow-xs"
        >
          <Sparkles size={11} aria-hidden="true" className="animate-pulse" /> autofilled
        </motion.span>
      )}
    </AnimatePresence>
  )
}
