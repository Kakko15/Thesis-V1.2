import { cn } from '../../lib/utils'

export function Skeleton({ className }) {
  return (
    <div
      className={cn(
        'shimmer rounded-2xl bg-[var(--muted)]',
        className,
      )}
    />
  )
}
