import { EyeOff, Lock, ShieldCheck, UserX } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SectionCard, SettingItem, SettingRows } from './SectionCard'

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
      <SectionCard title="How your data is handled" description="The guarantees the library makes about your information." flush>
        <SettingRows>
          {PRINCIPLES.map(({ icon, title, text }) => (
            <SettingItem key={title} icon={icon} title={title} description={text} />
          ))}
        </SettingRows>
      </SectionCard>

      <SectionCard title="Account removal" description="What to do when you no longer need access." flush>
        <SettingRows>
          <SettingItem
            icon={UserX}
            title="Request account deletion"
            description="Handled by an administrator, so archived contributions and audit trails stay intact."
            trailing={(
              <Button variant="outline" size="sm" onClick={() => { window.location.href = 'mailto:ccsict@isu.edu.ph?subject=Account%20deletion%20request' }}>
                Contact administrator
              </Button>
            )}
          />
        </SettingRows>
      </SectionCard>
    </div>
  )
}
