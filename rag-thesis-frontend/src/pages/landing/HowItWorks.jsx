import { useEffect, useRef, useState } from 'react'
import {
  motion, useMotionValueEvent, useScroll, useTransform,
} from 'framer-motion'
import { BrainCircuit, Database, ScanSearch, ShieldCheck } from 'lucide-react'
import { GlassCard } from '../../components/ui/GlassCard'
import { Reveal } from '../../components/ui/Motion'
import { ProgressRing } from '../../components/ui/ProgressRing'
import { SectionHeading } from './SectionHeading'
import { cn } from '../../lib/utils'
import { usePreferences } from '../../context/PreferencesContext'

/* ---- Per-step mini-visuals ---------------------------------------- */

function ChunkViz() {
  return (
    <div aria-hidden="true" className="flex max-w-sm flex-wrap gap-1.5">
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'animate-pulse-glow h-2.5 rounded-full',
            i % 5 === 0 ? 'w-10 bg-gold-400/70' : 'w-7 bg-forest-500/35',
          )}
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  )
}

function RetrieveViz() {
  return (
    <div aria-hidden="true" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-400 text-[0.65rem] font-extrabold text-forest-950">
        Q
      </span>
      <span className="animate-pulse-glow h-px w-10 bg-gradient-to-r from-gold-400 to-forest-500 sm:w-16" />
      <div className="flex flex-wrap gap-1.5">
        {['0.92', '0.81', '0.74'].map((score, i) => (
          <span
            key={score}
            className="animate-pulse-glow rounded-lg bg-forest-500/15 px-2 py-1 font-mono text-[0.65rem] font-semibold text-forest-700 dark:text-forest-300"
            style={{ animationDelay: `${i * 260}ms` }}
          >
            {score}
          </span>
        ))}
      </div>
    </div>
  )
}

function SynthViz() {
  const chip = 'rounded-md bg-gold-400/25 px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold text-gold-600 dark:text-gold-300'
  return (
    <div aria-hidden="true" className="max-w-sm space-y-2">
      <div className="shimmer h-2.5 w-full rounded-full bg-forest-500/15" />
      <div className="shimmer h-2.5 w-4/5 rounded-full bg-forest-500/15" />
      <div className="flex items-center gap-1.5">
        <div className="shimmer h-2.5 w-3/5 rounded-full bg-forest-500/15" />
        <span className={chip}>[1]</span>
        <span className={chip}>[2]</span>
      </div>
    </div>
  )
}

function GuardViz() {
  return <ProgressRing value={85} size={104} strokeWidth={9} label="threshold" />
}

/* ---- Copy (verbatim from the thesis paper pipeline) ---------------- */

const PIPELINE_STEPS = [
  {
    icon: Database,
    title: 'Digitize and index',
    tag: '800-token chunks · 768-dim vectors',
    text: 'CCSICT manuscripts are extracted, cleaned, and split into 800-token semantic chunks — each tagged with title, author, track, and year, then embedded into a 768-dimension vector space.',
    visual: ChunkViz,
  },
  {
    icon: ScanSearch,
    title: 'Retrieve by meaning',
    tag: 'Cosine similarity, not keywords',
    text: 'Your question becomes a vector too. Cosine similarity finds the closest thesis passages by meaning — not keywords — across the entire archive, full text included.',
    visual: RetrieveViz,
  },
  {
    icon: BrainCircuit,
    title: 'Synthesize with proof',
    tag: 'Gemini · in-line citations',
    text: 'Gemini writes the answer strictly from the retrieved passages, citing each source in-line. If nothing relevant exists, the system says so instead of inventing an answer.',
    visual: SynthViz,
  },
  {
    icon: ShieldCheck,
    title: 'Flag related topics',
    tag: '85% similarity threshold',
    text: 'Queries are compared at the configured cosine-similarity threshold. High-similarity results show the measured score and matched study for human review.',
    visual: GuardViz,
  },
]

/* ---- Pinned scroll-scrub (desktop) ---------------------------------- */

function StepPanel({ step, index, scrollYProgress }) {
  const start = index / 4
  const end = (index + 1) / 4
  const first = index === 0
  const last = index === 3
  const FADE = 0.05
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  // Explicit mapping (not keyframe arrays): the first panel's asymmetric
  // [1,1,1,0] keyframes made framer extrapolate past its window.
  const fades = (p) => ({
    fadeIn: first ? 1 : clamp01((p - start) / FADE),
    fadeOut: last ? 1 : clamp01((end - p) / FADE),
  })
  const opacity = useTransform(scrollYProgress, (p) => {
    const { fadeIn, fadeOut } = fades(p)
    return Math.min(fadeIn, fadeOut)
  })
  const y = useTransform(scrollYProgress, (p) => {
    const { fadeIn, fadeOut } = fades(p)
    return (first ? 0 : 44 * (1 - fadeIn)) + (last ? 0 : -44 * (1 - fadeOut))
  })
  const Visual = step.visual

  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0">
      <GlassCard strong className="relative flex h-full flex-col justify-center overflow-hidden p-8 sm:p-10">
        <div
          aria-hidden="true"
          className="absolute right-6 top-2 font-display text-[6rem] font-extrabold leading-none opacity-[0.06]"
        >
          0{index + 1}
        </div>
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/30">
          <step.icon size={24} className="text-gold-300" />
        </div>
        <h3 className="font-display text-2xl font-extrabold">{step.title}</h3>
        <p className="mt-3 max-w-md text-sm leading-relaxed opacity-65">{step.text}</p>
        <div className="mt-7">
          <Visual />
        </div>
      </GlassCard>
    </motion.div>
  )
}

function PinnedPipeline() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [active, setActive] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (p) =>
    setActive(Math.max(0, Math.min(3, Math.floor(p * 4)))),
  )
  const beamScale = useTransform(scrollYProgress, [0.02, 0.98], [0, 1])

  return (
    <div ref={ref} className="relative h-[340vh]">
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden px-6">
        <div className="mx-auto w-full max-w-6xl">
          <SectionHeading eyebrow="The pipeline">
            From bound paper to <em className="font-accent text-gradient-isu">grounded answers</em>
          </SectionHeading>

          <div className="mt-12 grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]">
            {/* Step rail with progress beam */}
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute bottom-5 left-[1.35rem] top-5 w-px bg-forest-900/10 dark:bg-white/10"
              />
              <motion.div
                aria-hidden="true"
                style={{ scaleY: beamScale }}
                className="absolute bottom-5 left-[1.35rem] top-5 w-px origin-top bg-gradient-to-b from-forest-500 to-gold-400"
              />
              <ol className="relative space-y-8">
                {PIPELINE_STEPS.map((step, i) => (
                  <li key={step.title} aria-current={i === active ? 'step' : undefined} className="flex items-start gap-4">
                    <span
                      className={cn(
                        'z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all duration-500',
                        i <= active
                          ? 'bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/30'
                          : 'glass',
                      )}
                    >
                      <step.icon size={19} className={i <= active ? 'text-gold-300' : 'opacity-45'} />
                    </span>
                    <span
                      className={cn(
                        'pt-1 transition-opacity duration-500',
                        i === active ? 'opacity-100' : 'opacity-40',
                      )}
                    >
                      <span className="font-display block font-bold">{step.title}</span>
                      <span className="mt-0.5 hidden text-xs opacity-60 xl:block">{step.tag}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Stage — panels cross-fade as the section scrubs */}
            <div className="relative h-[26rem]">
              {PIPELINE_STEPS.map((step, i) => (
                <StepPanel key={step.title} step={step} index={i} scrollYProgress={scrollYProgress} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---- Stacked fallback (mobile / short viewports / reduced motion) ---- */

function StackedPipeline() {
  return (
    <div className="mx-auto mt-14 grid max-w-6xl gap-6 md:grid-cols-2">
      {PIPELINE_STEPS.map((step, i) => {
        const Visual = step.visual
        return (
          <Reveal key={step.title} delay={i * 0.1}>
            <GlassCard hover className="relative h-full overflow-hidden p-6">
              <div
                aria-hidden="true"
                className="absolute right-5 top-5 font-display text-4xl font-extrabold opacity-[0.08]"
              >
                0{i + 1}
              </div>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/30">
                <step.icon size={24} className="text-gold-300" />
              </div>
              <h3 className="font-display text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">{step.text}</p>
              <div className="mt-5">
                <Visual />
              </div>
            </GlassCard>
          </Reveal>
        )
      })}
    </div>
  )
}

/* ---- Section ------------------------------------------------------- */

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function HowItWorks() {
  const { reducedMotion: reduced } = usePreferences()
  const pinnable = useMediaQuery('(min-width: 1024px) and (min-height: 640px)')

  return (
    <section id="pipeline" className="relative scroll-mt-24">
      {pinnable && !reduced ? (
        <PinnedPipeline />
      ) : (
        <div className="px-6 py-20">
          <SectionHeading eyebrow="The pipeline">
            From bound paper to <em className="font-accent text-gradient-isu">grounded answers</em>
          </SectionHeading>
          <StackedPipeline />
        </div>
      )}
    </section>
  )
}
