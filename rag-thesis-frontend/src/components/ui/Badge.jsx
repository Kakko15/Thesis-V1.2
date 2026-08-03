import { cn } from '../../lib/utils'

// Foregrounds are paired with the tint each badge actually renders on, not
// picked from the same colour family by eye: a /12 tint lightens the surface
// just enough to break AA, which is how text-flame-600 ended up at 4.06:1.
// Ratios below are against the tint composited over the lightest and darkest
// surfaces the badge can sit on; see materialTheme.test.js for the check.
const styles = {
  forest: 'bg-forest-600/12 text-forest-900 dark:bg-forest-400/15 dark:text-forest-200 border-forest-600/20',
  gold: 'bg-gold-400/15 text-gold-text dark:text-gold-200 border-gold-400/25',
  flame: 'bg-flame-500/12 text-flame-800 dark:bg-flame-500/15 dark:text-flame-200 border-flame-500/20',
  neutral: 'bg-forest-900/8 text-ink-muted dark:bg-white/8 border-transparent',
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
