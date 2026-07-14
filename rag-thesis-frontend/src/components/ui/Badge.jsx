import { cn } from '../../lib/utils'

const styles = {
  forest: 'bg-forest-600/12 text-forest-700 dark:bg-forest-400/15 dark:text-forest-300 border-forest-600/20',
  gold: 'bg-gold-400/15 text-gold-600 dark:text-gold-300 border-gold-400/25',
  flame: 'bg-flame-500/12 text-flame-600 dark:text-flame-400 border-flame-500/20',
  neutral: 'bg-forest-900/8 dark:bg-white/8 opacity-80 border-transparent',
}

export function Badge({ children, tone = 'forest', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold tracking-wide',
        styles[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function RoleBadge({ role }) {
  const tone = role === 'superadmin' ? 'flame' : role === 'admin' ? 'flame' : role === 'faculty' ? 'gold' : 'forest'
  const label = role === 'superadmin' ? 'Superadmin' : role === 'admin' ? 'Administrator' : role === 'faculty' ? 'Faculty' : 'Student'
  return <Badge tone={tone}>{label}</Badge>
}
