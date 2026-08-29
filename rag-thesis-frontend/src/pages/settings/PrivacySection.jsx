import { EyeOff, Lock, ShieldCheck, UserX } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SectionCard } from './SectionCard'

const PRINCIPLES = [
  {
    icon: Lock,
    title: 'Indirect archive access',
    text: 'Full manuscripts are never exposed through the interface. Content reaches you only as AI-synthesized answers with citations, protecting every author\u2019s intellectual property.',
  },
  {
    icon: EyeOff,
    title: 'Minimal footprint',
    text: 'The library stores your name, email, role, and conversations — nothing else. No tracking pixels, no advertising identifiers, no third-party analytics.',
  },
  {
    icon: ShieldCheck,
    title: 'Duplication screening',
    text: 'Uploads and novelty scans are checked against the archive at the 85% similarity threshold. Screening metadata is kept so faculty can audit decisions later.',
  },
]

export function PrivacySection() {
  return (
    <div className="space-y-5">
      <SectionCard icon={ShieldCheck} title="How your data is handled" description="The guarantees the library makes about your information.">
        <div className="space-y-3">
          {PRINCIPLES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="glass flex items-start gap-3.5 rounded-2xl p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-forest-600/12 dark:bg-forest-400/12">
                <Icon size={15} className="text-forest-700 dark:text-forest-300" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{title}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={UserX} title="Account removal" description="What to do when you no longer need access.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs leading-relaxed text-ink-muted">
            Account deletion is handled by an administrator so archived contributions and audit
            trails stay intact. Contact your department administrator to request removal.
          </p>
          <Button variant="outline" size="sm" onClick={() => { window.location.href = 'mailto:ccsict@isu.edu.ph?subject=Account%20deletion%20request' }}>
            Contact administrator
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}
