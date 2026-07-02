import { GraduationCap, Landmark, Users } from 'lucide-react'
import { Reveal, SpotlightCard } from '../../components/ui/Motion'
import { SectionHeading } from './SectionHeading'

const AUDIENCES = [
  {
    icon: GraduationCap,
    title: 'Students',
    text: 'Cut literature-review time from days to minutes. Discover related local studies, validate your topic before proposal, and cite with confidence.',
  },
  {
    icon: Users,
    title: 'Faculty advisers',
    text: 'Cross-reference proposals against years of accumulated theses in seconds. Streamline title defenses with data-backed novelty scans.',
  },
  {
    icon: Landmark,
    title: 'The CCSICT department',
    text: 'Preserve institutional memory in a structured, secure knowledge base — rescuing research from deteriorating shelves and scattered drives.',
  },
]

export function Audiences() {
  return (
    <section className="relative px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHeading eyebrow="Who it serves" className="mb-14">
          One archive, <em className="font-accent text-gradient-isu">three missions</em>
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
                  <p className="mt-2.5 text-sm leading-relaxed opacity-65">{audience.text}</p>
                </div>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
