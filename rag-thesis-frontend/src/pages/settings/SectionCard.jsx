import { motion } from 'framer-motion'
import { GlassCard } from '../../components/ui/GlassCard'
import { staggerItem } from '../../components/ui/Motion'

/**
 * One settings panel: gradient icon chip, title, description, then content.
 * Every section on /settings is built from these so the page reads as one
 * coherent surface.
 */
export function SectionCard({ icon: Icon, title, description, children, tone = 'forest', actions }) {
  return (
    <motion.div variants={staggerItem}>
      <GlassCard className="relative overflow-hidden p-6 sm:p-7">
        {/* Decorative glow — must never intercept clicks on the header actions. */}
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gold-400/10 blur-2xl" aria-hidden="true" />
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={
                tone === 'gold'
                  ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/25'
                  : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25'
              }
            >
              <Icon size={18} className={tone === 'gold' ? 'text-forest-950' : 'text-gold-300'} aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold">{title}</h2>
              {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
            </div>
          </div>
          {actions}
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}
