import { Reveal } from '../../components/ui/Motion'
import { cn } from '../../lib/utils'

/** Eyebrow + display heading lockup shared by every landing section. */
export function SectionHeading({ eyebrow, children, className }) {
  return (
    <Reveal className={cn('text-center', className)}>
      <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500 dark:text-gold-300">
        {eyebrow}
      </span>
      <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
        {children}
      </h2>
    </Reveal>
  )
}
