import { EyeOff, Lock, ShieldCheck, UserX } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SectionCard } from './SectionCard'

const PRINCIPLES = [
  {
    icon: Lock,
    title: 'Indirect archive access',
    text: 'The interface does not provide manuscript downloads. It returns AI-synthesized answers and limited cited metadata or excerpts from authorized archive content.',
  },
  {
    icon: EyeOff,
    title: 'Account and activity data',
    text: 'The library stores account and profile details, conversations, upload and novelty-scan records, and security or audit events needed to operate and review the service. It does not use advertising identifiers or third-party analytics.',
  },
  {
    icon: ShieldCheck,
    title: 'Duplication screening',
    text: 'Uploads and novelty scans are checked against the archive at the configured similarity threshold. Filenames, results, matched excerpts, decisions, and related review records may be retained for authorized audit and administration.',
  },
  {
    icon: ShieldCheck,
    title: 'AI processing',
    text: 'Questions and relevant archive content, document text, embeddings, and novelty-review content may be processed by Google Gemini services. Use is subject to applicable institutional privacy and corpus-handling requirements.',
  },
]

export function PrivacySection() {
  return (
    <div className="space-y-5">
      <SectionCard icon={ShieldCheck} title="How your data is handled" description="A summary of information used to provide and administer the library.">
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
            Account deletion is handled by an administrator so required archive and audit records
            can be reviewed. Contact the CCSICT system administrators to request removal.
          </p>
          <Button variant="outline" size="sm" onClick={() => { window.location.href = 'mailto:ccsict@isu.edu.ph?subject=Account%20deletion%20request' }}>
            Contact administrator
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}
