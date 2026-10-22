import { GraduationCap, Library, Sparkles } from 'lucide-react'
import { version } from '../../../package.json'
import { Logo } from '../../components/ui/Logo'
import { SectionCard, SettingItem, SettingRows } from './SectionCard'

const FEATURES = [
  { icon: Library, title: 'Semantic archive', text: 'Every thesis is vector-indexed, so search follows meaning rather than exact words.' },
  { icon: Sparkles, title: 'Citation-backed AI', text: 'Answers are grounded in archived theses and cite the passages they used.' },
  { icon: GraduationCap, title: 'Novelty screening', text: 'New work is compared against the archive at the 85% similarity threshold.' },
]

export function AboutSection() {
  return (
    <div className="space-y-5">
      <SectionCard title="ISU Thesis AI Library" flush>
        <div className="flex items-center gap-4 px-5 pb-5 sm:px-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800">
            <Logo size={32} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Version {version}</div>
            <div className="mt-0.5 text-sm text-ink-muted">CCSICT · Isabela State University, Echague</div>
          </div>
        </div>
        <p className="border-t border-[var(--border)] px-5 py-4 text-sm leading-relaxed text-ink-muted sm:px-6">
          A centralized, AI-powered thesis library using retrieval-augmented generation —
          semantic search, citation-backed answers, and novelty validation across the
          institutional archive.
        </p>
      </SectionCard>

      <SectionCard title="What it does" flush>
        <SettingRows>
          {FEATURES.map(({ icon, title, text }) => (
            <SettingItem key={title} icon={icon} title={title} description={text} />
          ))}
        </SettingRows>
      </SectionCard>
    </div>
  )
}
