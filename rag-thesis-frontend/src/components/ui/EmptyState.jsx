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
          <Icon size={28} className="text-forest-600 dark:text-gold-300" />
        </div>
      )}
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {message && <p className="mt-1.5 max-w-sm text-sm opacity-60">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  )
}
