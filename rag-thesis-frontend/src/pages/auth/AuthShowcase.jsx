import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Fingerprint, Landmark, Lock, MessageSquareText, Quote, ShieldCheck } from 'lucide-react'
import { Logo } from '../../components/ui/Logo'

const HIGHLIGHTS = [
  {
    icon: MessageSquareText,
    title: 'Ask in plain language',
    text: '"What local studies used CNNs for crop disease detection?" — answered in seconds, from real theses.',
  },
  {
    icon: Quote,
    title: 'Citations, always',
    text: 'Every claim links back to an archived CCSICT thesis — title, authors, track, and year.',
  },
  {
    icon: ShieldCheck,
    title: '85% originality guard',
    text: 'Proposals are screened against the whole archive before you ever face a title defense.',
  },
]

const TRUST = [
  { icon: Fingerprint, label: '2FA-ready' },
  { icon: Lock, label: 'RLS-secured' },
  { icon: Landmark, label: 'ISU · Est. 1978' },
]

/** Left brand panel — rotating feature spotlight + trust chips. */
export function AuthShowcase() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % HIGHLIGHTS.length), 4000)
    return () => clearInterval(id)
  }, [])

  const active = HIGHLIGHTS[index]

  return (
    <div className="relative z-10 max-w-md">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }}
      >
        <div className="animate-float inline-block">
          <div className="glass-strong rounded-full p-4 shadow-[0_0_60px_rgba(242,169,0,0.2)]">
            <Logo size={88} glow />
          </div>
        </div>

        <h1 className="font-display mt-8 text-4xl font-extrabold leading-tight tracking-tight">
          Research at the
          <br />
          <em className="font-accent text-gradient-isu">speed of thought</em>
        </h1>
        <p className="mt-4 text-sm leading-relaxed opacity-65">
          The Centralized AI-Powered Thesis Library of CCSICT, Isabela State University —
          semantic search, grounded synthesis, and novelty validation in one place.
        </p>

        {/* Rotating spotlight */}
        <div className="relative mt-8 h-32">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 18, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -14, filter: 'blur(4px)' }}
              transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
              className="glass absolute inset-x-0 top-0 rounded-2xl p-5"
            >
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/25">
                  <active.icon size={18} className="text-forest-950" />
                </div>
                <div>
                  <div className="font-display text-sm font-bold">{active.title}</div>
                  <p className="mt-1 text-xs leading-relaxed opacity-65">{active.text}</p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Spotlight pager dots */}
        <div className="mt-1 flex gap-1.5" role="tablist" aria-label="Feature highlights">
          {HIGHLIGHTS.map((h, i) => (
            <button
              key={h.title}
              role="tab"
              aria-selected={i === index}
              aria-label={h.title}
              onClick={() => setIndex(i)}
              className={
                i === index
                  ? 'h-1.5 w-6 rounded-full bg-gold-400 transition-all duration-300'
                  : 'h-1.5 w-1.5 rounded-full bg-forest-900/20 transition-all duration-300 hover:bg-forest-900/40 dark:bg-white/20 dark:hover:bg-white/40'
              }
            />
          ))}
        </div>

        {/* Trust chips */}
        <div className="mt-8 flex flex-wrap gap-2.5">
          {TRUST.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="glass-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.7rem] font-semibold opacity-75"
            >
              <Icon size={12} className="text-gold-500 dark:text-gold-300" />
              {label}
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
