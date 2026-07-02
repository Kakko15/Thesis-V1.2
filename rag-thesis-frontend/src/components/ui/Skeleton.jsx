import { cn } from '../../lib/utils'

export function Skeleton({ className }) {
  return (
    <div
      className={cn(
        'shimmer rounded-2xl bg-forest-900/8 dark:bg-white/[0.06]',
        className,
      )}
    />
  )
}
