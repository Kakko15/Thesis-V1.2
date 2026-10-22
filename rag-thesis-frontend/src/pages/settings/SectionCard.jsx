import { motion } from 'framer-motion'
import { staggerItem } from '../../components/ui/Motion'
import { cn } from '../../lib/utils'

/**
 * One settings panel, laid out as a Material 3 outlined card: a title, an
 * optional one-line description, then content.
 *
 * The earlier panel opened on a gradient icon tile with a decorative glow,
 * which put six identical green squares down the page and made every card
 * compete for the eye equally. The section rail already carries the icon, so
 * the card leads with its title, the way Google's account settings do, and
 * the surface matches the archive's outlined cards so the two pages read as
 * one product.
 */
export function SectionCard({ title, description, children, actions, flush = false }) {
  return (
    <motion.section variants={staggerItem} aria-label={title}>
      <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-0)] dark:bg-[var(--surface-1)]">
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold leading-snug">{title}</h3>
            {description && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        <div className={cn(flush ? 'mt-3' : 'px-5 pb-5 pt-4 sm:px-6 sm:pb-6')}>
          {children}
        </div>
      </div>
    </motion.section>
  )
}

/**
 * A card body made of rows separated by hairlines, edge to edge like
 * Google's account settings. Use inside `<SectionCard flush>`.
 */
export function SettingRows({ children }) {
  return <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">{children}</div>
}

/**
 * One row: a fixed-width label column, the value or description, and an
 * optional trailing control. Below `sm` the columns stack, so a long value
 * never forces the page sideways.
 */
export function SettingRow({ icon: Icon, label, children, trailing, className }) {
  return (
    <div className={cn('flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6', className)}>
      <div className="flex shrink-0 items-center gap-3 sm:w-44">
        {Icon && <Icon size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />}
        <span className="text-sm font-medium text-ink-muted">{label}</span>
      </div>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}

/**
 * A list item: icon, title, supporting text, and a trailing control such as a
 * switch or a button -- the Material 3 list row Google's settings are built
 * from. Replaces the tinted `glass` boxes each section used to draw around its
 * items, which gave every section a different idea of what an item looks like.
 * The trailing control wraps under the text on a narrow screen.
 */
export function SettingItem({ icon: Icon, title, description, trailing, tone = 'neutral', children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-4">
        {Icon && (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              tone === 'danger'
                ? 'bg-flame-500/10 text-flame-600 dark:text-flame-200'
                : 'bg-[var(--surface-2)] text-ink-muted dark:bg-[var(--surface-3)]',
            )}
          >
            <Icon size={18} />
          </span>
        )}
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-semibold">{title}</div>
          {description && <div className="mt-0.5 text-sm leading-relaxed text-ink-muted">{description}</div>}
          {children}
        </div>
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  )
}
