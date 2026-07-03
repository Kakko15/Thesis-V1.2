import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Fingerprint, Landmark, Lock, MessageSquareText, Quote, ShieldCheck } from 'lucide-react'
import { Logo } from '../../components/ui/Logo'
import { cn } from '../../lib/utils'
import { EASE } from './AuthFx'

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

const SPOT_INTERVAL = 4000

const TRUST = [
  { icon: Fingerprint, label: '2FA-ready' },
  { icon: Lock, label: 'RLS-secured' },
  { icon: Landmark, label: 'ISU · Est. 1978' },
]

const spotVariants = {
  enter: (dir) => ({ opacity: 0, x: 30 * dir, filter: 'blur(4px)' }),
  center: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit: (dir) => ({ opacity: 0, x: -30 * dir, filter: 'blur(4px)' }),
}

const chipStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.95 } },
}
const chipRise = {
  hidden: { opacity: 0, y: 12, scale: 0.94 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE } },
}

/** Per-word masked rise — each word slides up out of its own clip box.
    Words are joined with NBSP inside the clip spans so inline-block
    whitespace collapsing can't swallow the separators. */
function MaskedWords({ text, delay = 0, step = 0.07 }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.12em] -mb-[0.12em] align-baseline">
          <motion.span
            className="inline-block will-change-transform"
            initial={{ y: '110%' }}
            animate={{ y: '0%' }}
            transition={{ delay: delay + i * step, duration: 0.75, ease: EASE }}
          >
            {i < words.length - 1 ? word + '\u00A0' : word}
          </motion.span>
        </span>
      ))}
    </>
  )
}

/** Left brand panel — masked headline, rotating feature spotlight with a
    timed progress pager, and trust chips. */
export function AuthShowcase() {
  const [spot, setSpot] = useState({ index: 0, dir: 1 })

  // Auto-advance; re-arms whenever the index changes so a manual jump
  // gets a full cycle (and the pager fill stays in sync with the timer).
  useEffect(() => {
    const id = setInterval(
      () => setSpot((s) => ({ index: (s.index + 1) % HIGHLIGHTS.length, dir: 1 })),
      SPOT_INTERVAL,
    )
    return () => clearInterval(id)
  }, [spot.index])

  const active = HIGHLIGHTS[spot.index]

  return (
    <div className="relative z-10 max-w-md">
      {/* Floating brand mark with a breathing gold halo */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22, delay: 0.05 }}
        className="inline-block"
      >
        <div className="animate-float inline-block">
          <div className="glass-strong relative rounded-full p-4 shadow-[0_0_60px_rgba(242,169,0,0.2)]">
            <span aria-hidden="true" className="animate-pulse-glow absolute -inset-1.5 rounded-full border border-gold-400/30" />
            <Logo size={88} glow />
          </div>
        </div>
      </motion.div>

      <h1 className="font-display mt-8 text-4xl font-extrabold leading-tight tracking-tight">
        <MaskedWords text="Research at the" delay={0.25} />
        <br />
        <span className="inline-block overflow-hidden pb-2 -mb-2 pr-1">
          <motion.em
            className="font-accent text-gradient-isu inline-block will-change-transform"
            initial={{ y: '110%' }}
            animate={{ y: '0%' }}
            transition={{ delay: 0.5, duration: 0.8, ease: EASE }}
          >
            speed of thought
          </motion.em>
        </span>
      </h1>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.62, duration: 0.7, ease: EASE }}
        className="mt-4 text-sm leading-relaxed opacity-65"
      >
        The Centralized AI-Powered Thesis Library of CCSICT, Isabela State University —
        semantic search, grounded synthesis, and novelty validation in one place.
      </motion.p>

      {/* Rotating spotlight */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.78, duration: 0.7, ease: EASE }}
        className="relative mt-8 h-32"
      >
        <AnimatePresence mode="wait" custom={spot.dir}>
          <motion.div
            key={spot.index}
            custom={spot.dir}
            variants={spotVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: EASE }}
            className="glass absolute inset-x-0 top-0 rounded-2xl p-5"
          >
            <div className="flex items-start gap-3.5">
              <motion.div
                initial={{ scale: 0.7, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 20, delay: 0.08 }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-400 shadow-lg shadow-gold-400/25"
              >
                <active.icon size={18} className="text-forest-950" />
              </motion.div>
              <div>
                <div className="font-display text-sm font-bold">{active.title}</div>
                <p className="mt-1 text-xs leading-relaxed opacity-65">{active.text}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Pager — the active pill fills over the cycle duration */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.85, duration: 0.6 }}
        className="mt-1 flex gap-1.5"
        role="tablist"
        aria-label="Feature highlights"
      >
        {HIGHLIGHTS.map((h, i) => (
          <button
            key={h.title}
            role="tab"
            aria-selected={i === spot.index}
            aria-label={h.title}
            onClick={() => setSpot((s) => ({ index: i, dir: i >= s.index ? 1 : -1 }))}
            className={cn(
              'relative h-1.5 overflow-hidden rounded-full transition-all duration-500',
              i === spot.index
                ? 'w-7 bg-forest-900/15 dark:bg-white/15'
                : 'w-1.5 bg-forest-900/20 hover:bg-forest-900/40 dark:bg-white/20 dark:hover:bg-white/40',
            )}
          >
            {i === spot.index && (
              <motion.span
                key={`fill-${spot.index}`}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: SPOT_INTERVAL / 1000, ease: 'linear' }}
                className="absolute inset-0 origin-left rounded-full bg-gold-400"
              />
            )}
          </button>
        ))}
      </motion.div>

      {/* Trust chips */}
      <motion.div variants={chipStagger} initial="hidden" animate="show" className="mt-8 flex flex-wrap gap-2.5">
        {TRUST.map(({ icon: Icon, label }) => (
          <motion.span
            key={label}
            variants={chipRise}
            whileHover={{ y: -2, scale: 1.04 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            className="glass-subtle inline-flex cursor-default items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.7rem] font-semibold opacity-75"
          >
            <Icon size={12} className="text-gold-500 dark:text-gold-300" />
            {label}
          </motion.span>
        ))}
      </motion.div>
    </div>
  )
}
