import { GraduationCap, Info, Library, Sparkles } from 'lucide-react'
import { version } from '../../../package.json'
import { Logo } from '../../components/ui/Logo'
import { SectionCard } from './SectionCard'

export function AboutSection() {
  return (
    <div className="space-y-5">
      <SectionCard icon={Info} title="About this system" description="What you are using and who built it.">
        <div className="flex flex-col items-center py-4 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-forest-600 to-forest-800 shadow-xl shadow-forest-900/25">
            <Logo size={44} />
          </div>
          <div className="font-display text-xl font-extrabold">ISU Thesis AI Library</div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-ink-faint">
            CCSICT · Echague · v{version}
          </div>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
            A centralized, AI-powered thesis library using retrieval-augmented generation —
            semantic search, citation-backed answers, and novelty validation across the
            institutional archive.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="glass rounded-2xl p-4 text-center">
            <Library size={18} className="mx-auto text-forest-700 dark:text-forest-300" aria-hidden="true" />
            <div className="mt-2 text-xs font-bold">Semantic archive</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">Vector-indexed theses</div>
          </div>
          <div className="glass rounded-2xl p-4 text-center">
            <Sparkles size={18} className="mx-auto text-gold-text dark:text-gold-300" aria-hidden="true" />
            <div className="mt-2 text-xs font-bold">Citation-backed AI</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">Grounded answers only</div>
          </div>
          <div className="glass rounded-2xl p-4 text-center">
            <GraduationCap size={18} className="mx-auto text-forest-700 dark:text-forest-300" aria-hidden="true" />
            <div className="mt-2 text-xs font-bold">Novelty screening</div>
            <div className="mt-0.5 text-[11px] text-ink-muted">85% threshold</div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
