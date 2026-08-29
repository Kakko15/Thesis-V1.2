import {
  BrainCircuit, Globe, Lock, LockOpen, MessageSquareText, Quote, ShieldCheck, Sparkles,
} from 'lucide-react'
import { Aurora } from '../../components/ui/Aurora'
import { GlassCard } from '../../components/ui/GlassCard'
import { ProgressRing } from '../../components/ui/ProgressRing'
import { Reveal, SpotlightCard, TiltCard } from '../../components/ui/Motion'
import { SectionHeading } from './SectionHeading'
import { cn } from '../../lib/utils'

const citationChip =
  'rounded-md bg-gold-400/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-gold-text dark:text-gold-300'

/** Bento grid — research-integrity controls represented with illustrative visuals. */
export function BentoFeatures() {
  return (
    <section id="features" className="relative scroll-mt-24 px-6 py-24">
      <Aurora subtle />
      <div className="relative mx-auto max-w-6xl">
        <SectionHeading eyebrow="Built for research integrity" className="mb-14">
          Built for <em className="font-accent text-gradient-isu">traceability</em>
          <span className="text-gold-400">.</span>
        </SectionHeading>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Large: semantic chat */}
          <Reveal className="sm:col-span-2 lg:col-span-4">
            <SpotlightCard>
              <GlassCard hover className="group relative h-full overflow-hidden p-8">
                <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-forest-500/15 blur-3xl transition-all duration-700 group-hover:bg-forest-500/25" />
                <MessageSquareText size={26} className="mb-4 text-gold-400" />
                <h3 className="font-display text-2xl font-extrabold">
                  Semantic retrieval for research questions
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
                  Ask research questions in plain language. When qualifying archive passages are
                  found, IskAI generates a citation-marked response tied to matching thesis metadata.
                </p>
                <div className="glass relative mt-6 overflow-hidden rounded-2xl p-4 text-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800">
                      <Sparkles size={14} className="text-gold-300" />
                    </div>
                    <p className="opacity-80">
                      Example: retrieved archive passages are summarized with source markers
                      <span className={cn(citationChip, 'mx-1')}>[1]</span>
                      <span className={citationChip}>[2]</span>
                      for the matching studies…
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="animate-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                  />
                </div>
              </GlassCard>
            </SpotlightCard>
          </Reveal>

          {/* Duplication guard */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <TiltCard>
              <GlassCard hover className="relative h-full overflow-hidden p-8">
                <ShieldCheck size={26} className="mb-4 text-flame-500" />
                <h3 className="font-display text-xl font-extrabold">Similarity alert, 85% by default</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  A matching archive passage can trigger an advisory alert with its measured score
                  and matched-study metadata. Faculty review remains the final decision.
                </p>
                <div className="mt-5">
                  <ProgressRing value={85} size={104} strokeWidth={9} label="similarity" />
                </div>
              </GlassCard>
            </TiltCard>
          </Reveal>

          {/* Citations */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <TiltCard>
              <GlassCard hover className="h-full overflow-hidden p-8">
                <Quote size={26} className="mb-4 text-gold-400" />
                <h3 className="font-display text-xl font-extrabold">Traceable citation metadata</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  Evidence-backed answers show available source metadata — title, authors, track,
                  and year — plus indexed citation locations where available.
                </p>
                {/* Chip fan spreads on hover */}
                <div aria-hidden="true" className="relative mt-6 h-16">
                  {['Title · Year', 'Authors · Track', 'Citation location'].map((label, i) => (
                    <span
                      key={label}
                      className={cn(
                        'glass absolute left-0 top-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow transition-all duration-500',
                        i === 0 && 'z-30 group-hover:-translate-y-1 group-hover:-rotate-3',
                        i === 1 &&
                          'z-20 translate-x-3 translate-y-2.5 group-hover:translate-x-9 group-hover:translate-y-1.5 group-hover:rotate-2',
                        i === 2 &&
                          'z-10 translate-x-6 translate-y-5 group-hover:translate-x-[4.5rem] group-hover:translate-y-4 group-hover:rotate-6',
                      )}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </GlassCard>
            </TiltCard>
          </Reveal>

          {/* Indirect access */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <TiltCard>
              <GlassCard hover className="h-full p-8">
                <div className="relative mb-4 h-7 w-7">
                  <LockOpen
                    size={26}
                    className="absolute inset-0 text-forest-500 transition-all duration-300 group-hover:scale-90 group-hover:opacity-0 dark:text-forest-300"
                  />
                  <Lock
                    size={26}
                    className="absolute inset-0 scale-90 text-forest-500 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100 dark:text-forest-300"
                  />
                </div>
                <h3 className="font-display text-xl font-extrabold">Indirect by design</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  Users cannot view or download full manuscripts through the application. The archive
                  provides metadata, optional abstracts, citation locations, and research answers.
                </p>
                <div aria-hidden="true" className="mt-5 inline-flex items-center gap-2 rounded-full bg-forest-500/10 px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-forest-700 dark:text-forest-300">
                  <Lock size={11} /> Protected archive access
                </div>
              </GlassCard>
            </TiltCard>
          </Reveal>

          {/* Knowledge isolation */}
          <Reveal delay={0.15} className="lg:col-span-2">
            <TiltCard>
              <GlassCard hover className="relative h-full overflow-hidden p-8">
                <div aria-hidden="true" className="bg-grid mask-fade-b absolute inset-0 opacity-60" />
                <div className="relative">
                  <BrainCircuit size={26} className="mb-4 text-forest-500 dark:text-forest-300" />
                  <h3 className="font-display text-xl font-extrabold">Archive-grounded answers</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    IskAI has no open-web search integration and is prompted to answer from retrieved
                    archive context. When no qualifying evidence is found, it returns a clear no-result notice.
                  </p>
                  {/* Research evidence comes from the indexed archive, not public-web search. */}
                  <div aria-hidden="true" className="mt-5 flex items-center gap-3">
                    <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-forest-900/15 dark:bg-white/10">
                      <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow dark:bg-ivory-200" />
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                      <Globe size={13} />
                      <span className="line-through">Open-web search</span>
                    </span>
                    <span className="ml-auto rounded-md bg-forest-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-forest-700 dark:text-forest-300">
                      Indexed archive
                    </span>
                  </div>
                </div>
              </GlassCard>
            </TiltCard>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
