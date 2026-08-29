import { GraduationCap, Landmark, Users } from 'lucide-react'
import { Reveal, SpotlightCard } from '../../components/ui/Motion'
import { SectionHeading } from './SectionHeading'

const AUDIENCES = [
  {
    icon: GraduationCap,
    title: 'For students',
    text: 'Search indexed CCSICT theses by topic, review citation-marked answers, and identify potentially overlapping topics for faculty discussion.',
  },
  {
    icon: Users,
    title: 'For approved faculty advisers',
    text: 'Review proposed topics against the indexed department archive. Similarity results are advisory and support, not replace, faculty judgment.',
  },
  {
    icon: Landmark,
    title: 'For CCSICT',
    text: 'Build an access-controlled thesis archive with structured metadata, private source storage, and AI-mediated research access.',
  },
]

export function Audiences() {
  return (
    <section className="relative px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Who it serves" className="mb-14">
          One CCSICT archive, <em className="font-accent text-gradient-isu">three uses</em>
        </SectionHeading>
        <div className="grid gap-5 md:grid-cols-3">
          {AUDIENCES.map((audience, i) => (
            <Reveal key={audience.title} delay={i * 0.12}>
              <SpotlightCard>
                <div className="gradient-border gradient-border-glass h-full rounded-[1.5rem] p-8 text-center shadow-[0_8px_32px_rgba(4,42,24,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/30">
                    <audience.icon size={26} className="text-forest-950" />
                  </div>
                  <h3 className="font-display text-xl font-extrabold">{audience.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{audience.text}</p>
                </div>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
