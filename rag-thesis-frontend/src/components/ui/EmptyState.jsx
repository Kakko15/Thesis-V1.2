import { motion } from 'framer-motion'

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      {Icon && (
        <div className="glass mb-5 flex h-16 w-16 items-center justify-center rounded-3xl">
          <Icon size={28} className="text-[var(--primary)]" />
        </div>
      )}
      {/* h2: every surface that renders an empty state does so as top-level page
          content directly under the page h1, so h3 skipped a level. */}
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {message && <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  )
}
