import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  Sparkles, BookMarked, ShieldCheck, Quote, BrainCircuit, Lock,
  ArrowRight, MessageSquareText, Database, GitBranch, ScanSearch,
  GraduationCap, Users, Landmark, ChevronDown, Moon, Sun,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../hooks/useTheme'
import { getPublicSummary, getTracks } from '../api'
import { Aurora } from '../components/ui/Aurora'
import { Logo } from '../components/ui/Logo'
import { Button } from '../components/ui/Button'
import { GlassCard } from '../components/ui/GlassCard'
import { Reveal, AnimatedCounter, staggerContainer, staggerItem } from '../components/ui/Motion'
import { cn } from '../lib/utils'

/* ------------------------------------------------------------------ */
/* Navbar that glassifies on scroll                                    */
/* ------------------------------------------------------------------ */
function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const { user } = useAuth()
  const { isDark, toggle } = useTheme()
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        scrolled ? 'px-3 pt-3 sm:px-6' : 'px-0 pt-0',
      )}
    >
      <div
        className={cn(
          'mx-auto flex h-16 max-w-6xl items-center justify-between px-5 transition-all duration-500',
          scrolled ? 'glass-strong rounded-3xl' : 'bg-transparent',
        )}
      >
        <Link to="/" className="flex items-center gap-3">
          <Logo size={38} glow />
          <div className="leading-tight">
            <div className="font-display text-sm font-extrabold tracking-tight sm:text-base">
              ISU Thesis <span className="text-gradient-gold">AI</span> Library
            </div>
            <div className="hidden text-[0.6rem] font-semibold uppercase tracking-[0.16em] opacity-55 sm:block">
              Isabela State University · CCSICT
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => navigate('/chat')}>
            Try as guest
          </Button>
          {user ? (
            <Button variant="gold" size="sm" onClick={() => navigate('/dashboard')}>
              Open dashboard <ArrowRight size={14} />
            </Button>
          ) : (
            <Button variant="gold" size="sm" onClick={() => navigate('/login')}>
              Sign in <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </div>
    </motion.header>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */
function Hero() {
  const navigate = useNavigate()
  const { scrollY } = useScroll()
  const sealY = useTransform(scrollY, [0, 600], [0, 120])
  const heroOpacity = useTransform(scrollY, [0, 500], [1, 0.2])

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-24 pb-16">
      <Aurora />

      {/* Floating glass ISU seal */}
      <motion.div style={{ y: sealY }} className="relative mb-10">
        <div className="animate-float">
          <div className="glass-strong rounded-full p-5 shadow-[0_0_80px_rgba(242,169,0,0.25)]">
            <Logo size={110} glow className="ring-4" />
          </div>
        </div>
        <div className="absolute -inset-8 -z-10 animate-pulse-glow rounded-full bg-gold-400/10 blur-3xl" />
      </motion.div>

      <motion.div style={{ opacity: heroOpacity }} className="relative z-10 mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.7, ease: [0.2, 0, 0, 1] }}
          className="glass mx-auto mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
        >
          <Sparkles size={13} className="text-gold-400" />
          Retrieval-Augmented Generation · Closed-domain · Citation-backed
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.8, ease: [0.2, 0, 0, 1] }}
          className="font-display text-4xl font-extrabold leading-[1.06] tracking-tight sm:text-6xl lg:text-7xl"
        >
          Every CCSICT thesis,
          <br />
          <span className="text-gradient-isu">one intelligent answer</span>
          <span className="text-gold-400">.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: [0.2, 0, 0, 1] }}
          className="mx-auto mt-6 max-w-2xl text-base leading-relaxed opacity-70 sm:text-lg"
        >
          The Centralized AI-Powered Thesis Library of Isabela State University, Echague.
          Ask in plain language — get AI-synthesized answers grounded exclusively in the
          CCSICT archive, with traceable citations and automatic topic-duplication alerts.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.8, ease: [0.2, 0, 0, 1] }}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button size="xl" variant="gold" onClick={() => navigate('/chat')} className="group">
            <MessageSquareText size={19} />
            Start asking
            <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-1" />
          </Button>
          <Button size="xl" variant="secondary" onClick={() => navigate('/login')}>
            <GraduationCap size={19} />
            Create student account
          </Button>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="absolute bottom-8 flex flex-col items-center gap-1 text-xs opacity-40"
      >
        Scroll to explore
        <ChevronDown size={16} className="animate-bounce" />
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Live archive stats                                                  */
/* ------------------------------------------------------------------ */
function StatsStrip() {
  const { data } = useQuery({ queryKey: ['public-summary'], queryFn: getPublicSummary, retry: false })
  const stats = [
    { label: 'Theses indexed', value: data?.total_papers ?? 0, icon: BookMarked },
    { label: 'Academic tracks', value: data?.total_tracks ?? 0, icon: GitBranch },
    { label: 'Questions answered', value: data?.total_queries ?? 0, icon: MessageSquareText },
    {
      label: 'Years of research',
      value: data?.year_range ? Math.max(1, data.year_range.to - data.year_range.from + 1) : 0,
      icon: Landmark,
    },
  ]
  return (
    <section className="relative px-6 py-12">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
        className="mx-auto grid max-w-5xl grid-cols-2 gap-4 lg:grid-cols-4"
      >
        {stats.map(({ label, value, icon: Icon }) => (
          <motion.div key={label} variants={staggerItem}>
            <GlassCard hover className="flex flex-col items-center gap-1.5 px-4 py-7 text-center">
              <Icon size={20} className="mb-1 text-gold-400" />
              <span className="font-display text-3xl font-extrabold">
                <AnimatedCounter value={value} />
              </span>
              <span className="text-xs font-medium uppercase tracking-wider opacity-55">{label}</span>
            </GlassCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* How RAG works — scroll storytelling                                 */
/* ------------------------------------------------------------------ */
const PIPELINE_STEPS = [
  {
    icon: Database,
    title: 'Digitize and index',
    text: 'CCSICT manuscripts are extracted, cleaned, and split into 800-token semantic chunks — each tagged with title, author, track, and year, then embedded into a 768-dimension vector space.',
  },
  {
    icon: ScanSearch,
    title: 'Retrieve by meaning',
    text: 'Your question becomes a vector too. Cosine similarity finds the closest thesis passages by meaning — not keywords — across the entire archive, full text included.',
  },
  {
    icon: BrainCircuit,
    title: 'Synthesize with proof',
    text: 'Gemini writes the answer strictly from the retrieved passages, citing each source in-line. If nothing relevant exists, the system says so instead of inventing an answer.',
  },
  {
    icon: ShieldCheck,
    title: 'Guard originality',
    text: 'Every query is screened against the 85% cosine-similarity duplication threshold. Redundant topics are flagged instantly with the exact match percentage and study summary.',
  },
]

function HowItWorks() {
  return (
    <section className="relative px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mb-16 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500 dark:text-gold-300">
            The pipeline
          </span>
          <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
            From bound paper to <span className="text-gradient-isu">grounded answers</span>
          </h2>
        </Reveal>

        <div className="relative grid gap-6 lg:grid-cols-4">
          <div className="absolute left-0 right-0 top-10 hidden h-px bg-gradient-to-r from-transparent via-forest-500/40 to-transparent lg:block" />
          {PIPELINE_STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.12}>
              <GlassCard hover className="relative h-full p-6">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/30">
                  <step.icon size={24} className="text-gold-300" />
                </div>
                <div className="absolute right-5 top-5 font-display text-4xl font-extrabold opacity-[0.08]">
                  0{i + 1}
                </div>
                <h3 className="font-display text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed opacity-65">{step.text}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Bento feature grid                                                  */
/* ------------------------------------------------------------------ */
function BentoFeatures() {
  return (
    <section className="relative px-6 py-24">
      <Aurora subtle />
      <div className="relative mx-auto max-w-6xl">
        <Reveal className="mb-14 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500 dark:text-gold-300">
            Built for research integrity
          </span>
          <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
            Everything the paper promised<span className="text-gold-400">.</span>
          </h2>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Large: semantic chat */}
          <Reveal className="sm:col-span-2 lg:col-span-4">
            <GlassCard hover className="group relative h-full overflow-hidden p-8">
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-forest-500/15 blur-3xl transition-all duration-700 group-hover:bg-forest-500/25" />
              <MessageSquareText size={26} className="mb-4 text-gold-400" />
              <h3 className="font-display text-2xl font-extrabold">Semantic search that understands intent</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed opacity-65">
                No more rigid keyword catalogs. Ask "what local studies used CNNs for crop disease
                detection?" and get a synthesized answer that cites the exact CCSICT theses —
                methodologies, scopes, and findings included.
              </p>
              <div className="glass mt-6 rounded-2xl p-4 text-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800">
                    <Sparkles size={14} className="text-gold-300" />
                  </div>
                  <p className="opacity-80">
                    Two archived studies applied convolutional networks to agricultural imagery
                    <span className="mx-1 rounded-md bg-gold-400/20 px-1.5 py-0.5 font-mono text-xs text-gold-600 dark:text-gold-300">[1]</span>
                    <span className="rounded-md bg-gold-400/20 px-1.5 py-0.5 font-mono text-xs text-gold-600 dark:text-gold-300">[2]</span>
                    — both within the Data Mining track…
                  </p>
                </div>
              </div>
            </GlassCard>
          </Reveal>

          {/* Duplication guard */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <GlassCard hover className="relative h-full overflow-hidden p-8">
              <ShieldCheck size={26} className="mb-4 text-flame-500" />
              <h3 className="font-display text-xl font-extrabold">85% duplication guard</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">
                Topic redundancy is flagged the moment it appears — with the exact cosine-similarity
                percentage and a summary of the matched study for you and your adviser.
              </p>
              <div className="mt-5 flex items-center gap-3">
                <span className="font-display text-4xl font-extrabold text-flame-500">85%</span>
                <span className="text-xs uppercase tracking-wider opacity-50">similarity<br />threshold</span>
              </div>
            </GlassCard>
          </Reveal>

          {/* Citations */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <GlassCard hover className="h-full p-8">
              <Quote size={26} className="mb-4 text-gold-400" />
              <h3 className="font-display text-xl font-extrabold">Traceable citations, always</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">
                Every claim links back to a real archived thesis — title, authors, track, and year.
                Zero fabricated references, by architecture.
              </p>
            </GlassCard>
          </Reveal>

          {/* Indirect access */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <GlassCard hover className="h-full p-8">
              <Lock size={26} className="mb-4 text-forest-500 dark:text-forest-300" />
              <h3 className="font-display text-xl font-extrabold">Indirect by design</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">
                Full manuscripts are never viewable or downloadable. Knowledge flows through
                AI-mediated synthesis only — protecting every author's intellectual property.
              </p>
            </GlassCard>
          </Reveal>

          {/* Knowledge isolation */}
          <Reveal delay={0.15} className="lg:col-span-2">
            <GlassCard hover className="h-full p-8">
              <BrainCircuit size={26} className="mb-4 text-forest-500 dark:text-forest-300" />
              <h3 className="font-display text-xl font-extrabold">Closed-domain honesty</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">
                The AI is architecturally barred from the open internet. It answers from the CCSICT
                archive or tells you nothing relevant exists — hallucination mitigated, not hidden.
              </p>
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Tracks marquee                                                      */
/* ------------------------------------------------------------------ */
function TracksMarquee() {
  const { data: tracks } = useQuery({ queryKey: ['tracks'], queryFn: getTracks, retry: false })
  const items = tracks?.length
    ? tracks
    : ['Data Mining', 'Web Development', 'Network Security', 'Intelligent Systems', 'Information Management']
  const row = [...items, ...items]
  return (
    <section className="relative overflow-hidden py-12">
      <div className="mask-fade-x">
        <div className="flex w-max animate-marquee gap-4">
          {row.map((track, i) => (
            <div
              key={`${track}-${i}`}
              className="glass flex items-center gap-2.5 rounded-full px-6 py-3 text-sm font-semibold"
            >
              <span className="h-2 w-2 rounded-full bg-gold-400" />
              {track}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Audience cards                                                      */
/* ------------------------------------------------------------------ */
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

function Audiences() {
  return (
    <section className="relative px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mb-14 text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold-500 dark:text-gold-300">
            Who it serves
          </span>
          <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">
            One archive, <span className="text-gradient-isu">three missions</span>
          </h2>
        </Reveal>
        <div className="grid gap-5 md:grid-cols-3">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 0.12}>
              <GlassCard hover className="h-full p-8 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/30">
                  <a.icon size={26} className="text-forest-950" />
                </div>
                <h3 className="font-display text-xl font-extrabold">{a.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed opacity-65">{a.text}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Final CTA + footer                                                  */
/* ------------------------------------------------------------------ */
function FinalCTA() {
  const navigate = useNavigate()
  return (
    <section className="relative px-6 py-24">
      <Reveal>
        <GlassCard strong className="relative mx-auto max-w-4xl overflow-hidden p-10 text-center sm:p-16">
          <div className="absolute inset-0 bg-gradient-to-br from-forest-700/90 to-forest-900/95" />
          <div className="absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-gold-400/20 blur-3xl" />
          <div className="relative">
            <Logo size={64} glow className="mx-auto mb-6" />
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Your next thesis starts with a question.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Join the students and advisers of ISU Echague already researching at the speed of thought.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="xl" variant="gold" onClick={() => navigate('/login')} className="group">
                Get started free
                <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
              <Button
                size="xl"
                variant="ghost"
                className="text-white hover:bg-white/10"
                onClick={() => navigate('/chat')}
              >
                Explore as guest
              </Button>
            </div>
          </div>
        </GlassCard>
      </Reveal>

      <footer className="mx-auto mt-20 max-w-6xl border-t border-forest-900/10 pt-10 text-center dark:border-white/10">
        <div className="flex flex-col items-center gap-3">
          <Logo size={44} />
          <div className="font-display text-sm font-bold">ISU Thesis AI Library</div>
          <p className="max-w-md text-xs leading-relaxed opacity-50">
            A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation.
            College of Computing Studies, Information and Communication Technology,
            Isabela State University, Echague, Isabela.
          </p>
          <p className="text-xs opacity-40">
            © {new Date().getFullYear()} Isabela State University · Est. 1978
          </p>
        </div>
      </footer>
    </section>
  )
}

/* ------------------------------------------------------------------ */
export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <LandingNav />
      <Hero />
      <StatsStrip />
      <HowItWorks />
      <TracksMarquee />
      <BentoFeatures />
      <Audiences />
      <FinalCTA />
    </div>
  )
}
