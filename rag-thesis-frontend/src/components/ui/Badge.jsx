import { badgeToneClass, DEFAULT_BADGE_TONE } from '../../design/badgeTones.js'
import { cn } from '../../lib/utils'

export function Badge({ children, tone = DEFAULT_BADGE_TONE, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide',
        badgeToneClass(tone),
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
