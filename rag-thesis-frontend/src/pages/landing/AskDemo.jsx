import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { BookMarked, RotateCcw, Send } from 'lucide-react'
import { GlassCard } from '../../components/ui/GlassCard'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Logo } from '../../components/ui/Logo'
import { AnimatedLogo } from '../../components/ui/AnimatedLogo'
import { LogoActivityDots } from '../../components/ui/LogoActivityDots'
import { Reveal } from '../../components/ui/Motion'
import { SectionHeading } from './SectionHeading'
import { contentKeys } from '../../lib/keys'
import { usePreferences } from '../../context/PreferencesContext'

/* Fully scripted product demo — no API calls. Mirrors the live Chat page
   UI: the question types into the composer, sends into the thread as an
   avatarless bubble, IskAI thinks with the AnimatedLogo indicator, then the
   answer streams and evidence source cards land. Phases:
   0 idle · 1 typing in composer · 2 sent + thinking · 3 streaming answer · 4 sources */

const QUESTION = 'What local studies used CNNs for crop disease detection?'
const ANSWER_WORDS =
  'Two archived studies applied convolutional neural networks to agricultural imagery [1] [2] — both within the Data Mining track. The 2023 study reached 94% accuracy detecting rice-leaf blight, while the 2021 work classified maize diseases from smartphone photos.'.split(' ')
// The demo answer repeats common words, so keys carry an occurrence number.
const ANSWER_WORD_KEYS = contentKeys(ANSWER_WORDS, 'answer-word')
const SOURCES = [
  { n: 1, title: 'CNN-Based Rice Leaf Disease Detection', meta: 'Data Mining · 2023', track: 'Data Mining' },
  { n: 2, title: 'Maize Disease Image Classification', meta: 'Data Mining · 2021', track: 'Data Mining' },
]

const TYPE_MS = 26
const SEND_PAUSE_MS = 600
const THINK_MS = 1000
const WORD_MS = 42

const wordVariant = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

const isCitation = (word) => /^\[\d+\]$/.test(word)

export function AskDemo() {
  const { reducedMotion: reduced } = usePreferences()
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-120px' })
  const [runId, setRunId] = useState(0)
  const [phase, setPhase] = useState(0)
  const [typed, setTyped] = useState('')
  const threadRef = useRef(null)

  // Fixed-height thread: each new phase scrolls the thread itself (never the
  // page — scrollIntoView would drag the whole window with it).
  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTo({ top: thread.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [phase, reduced])

  useEffect(() => {
    if (!inView) return undefined
    const timers = []
    if (reduced) {
      // Skip the animation: jump straight to the final frame.
      timers.push(setTimeout(() => setPhase(4), 0))
      return () => timers.forEach(clearTimeout)
    }
    let i = 0
    const typeNext = () => {
      i += 1
      setTyped(QUESTION.slice(0, i))
      if (i < QUESTION.length) {
        timers.push(setTimeout(typeNext, TYPE_MS))
      } else {
        // Send: the composer clears and the bubble drops into the thread.
        timers.push(setTimeout(() => { setTyped(''); setPhase(2) }, SEND_PAUSE_MS))
        timers.push(setTimeout(() => setPhase(3), SEND_PAUSE_MS + THINK_MS))
        timers.push(
          setTimeout(
            () => setPhase(4),
            SEND_PAUSE_MS + THINK_MS + ANSWER_WORDS.length * WORD_MS + 500,
          ),
        )
      }
    }
    timers.push(
      setTimeout(() => {
        setPhase(1)
        setTyped('')
        typeNext()
      }, 450),
    )
    return () => timers.forEach(clearTimeout)
  }, [inView, runId, reduced])

  const replay = () => {
    setPhase(0)
    setTyped('')
    setRunId((r) => r + 1)
  }

  return (
    <section id="demo" ref={ref} className="relative scroll-mt-24 px-6 py-24">
      <SectionHeading eyebrow="See it think">
        Ask like a student, <em className="font-accent text-gradient-isu">cited like a scholar</em>
      </SectionHeading>

      <Reveal delay={0.1}>
        <GlassCard strong className="mx-auto mt-12 flex max-w-3xl flex-col overflow-hidden rounded-[2rem]">
          {/* Header — same as the live chat header */}
          <div className="flex items-center justify-between gap-3 border-b border-forest-900/10 px-4 py-3 dark:border-white/10 sm:px-5 sm:py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <Logo size={32} />
              <div className="min-w-0">
                <div className="font-display text-sm font-extrabold">IskAI</div>
                <div className="truncate text-xs text-ink-faint">
                  Grounded in the CCSICT archive · citations included
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="neutral">Guest Researcher</Badge>
              <Button variant="ghost" size="icon-sm" aria-label="Replay the demo" onClick={replay}>
                <RotateCcw size={14} />
              </Button>
            </div>
          </div>

          {/* Conversation — fixed height, scrolls internally */}
          <div ref={threadRef} className="h-[24rem] space-y-6 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6">
            {/* User bubble — current style: avatarless, accent corner */}
            {phase >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
                className="flex justify-end"
              >
                <div className="max-w-[85%] sm:max-w-[70%]">
                  <div className="rounded-3xl rounded-br-lg bg-gradient-to-br from-forest-600 to-forest-800 px-5 py-3 text-sm leading-relaxed text-white shadow-lg shadow-forest-900/20">
                    {QUESTION}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Thinking — the same indicator the live chat shows */}
            {phase === 2 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex h-10 items-center gap-2"
                role="status"
                aria-live="polite"
                aria-label="IskAI is searching the thesis archive"
              >
                <AnimatedLogo size={40} />
                <LogoActivityDots />
              </motion.div>
            )}

            {/* AI answer — bare logo, glass bubble, sources below */}
            {phase >= 3 && (
              <div className="flex gap-3">
                <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center">
                  <Logo size={40} />
                </div>
                <motion.div
                  initial={reduced ? false : { opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
                  className="min-w-0 max-w-full flex-1 sm:max-w-[85%]"
                >
                  <div className="glass rounded-3xl rounded-tl-lg px-5 py-4 text-sm leading-relaxed">
                    <motion.span
                      key={runId}
                      initial="hidden"
                      animate="show"
                      transition={{ staggerChildren: WORD_MS / 1000 }}
                    >
                      {ANSWER_WORDS.map((word, i) =>
                        isCitation(word) ? (
                          <motion.span
                            key={ANSWER_WORD_KEYS[i]}
                            variants={wordVariant}
                            className="mx-0.5 inline-block rounded-md bg-gold-400/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-gold-text dark:text-gold-300"
                          >
                            {word}
                          </motion.span>
                        ) : (
                          <motion.span key={ANSWER_WORD_KEYS[i]} variants={wordVariant} className="inline">
                            {word}{' '}
                          </motion.span>
                        ),
                      )}
                    </motion.span>
                  </div>

                  {/* Evidence sources — same card style as the live chat */}
                  {phase >= 4 && (
                    <motion.div
                      initial={reduced ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
                      className="mt-3 space-y-2"
                    >
                      <div className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wider text-ink-faint">
                        <BookMarked size={12} /> Evidence sources
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SOURCES.map((source, i) => (
                          <motion.div
                            key={source.n}
                            initial={reduced ? false : { opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                            className="glass flex w-full items-start gap-3 rounded-2xl p-3.5 text-left"
                          >
                            <div className="flex max-w-16 shrink-0 flex-wrap gap-1">
                              <div className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-gold-400/20 px-1.5 font-mono text-xs font-bold text-gold-text dark:text-gold-300">
                                {source.n}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold leading-snug">{source.title}</div>
                              <div className="mt-1 text-xs text-ink-muted">{source.meta}</div>
                              <div className="mt-1.5">
                                <Badge tone="forest">{source.track}</Badge>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </div>
            )}
          </div>

          {/* Composer — scripted: the question types here, then sends */}
          <div className="border-t border-forest-900/10 p-4 dark:border-white/10" aria-hidden="true">
            <div className="glass flex items-end gap-2 rounded-[1.4rem] p-2">
              <div className="max-h-36 min-h-10 flex-1 px-3 py-2 text-sm leading-relaxed">
                {phase === 1 ? (
                  <>
                    {typed}
                    <span className="animate-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-forest-600 dark:bg-forest-300" />
                  </>
                ) : (
                  <span className="opacity-45">
                    {typed || 'Ask IskAI about CCSICT thesis research…'}
                  </span>
                )}
              </div>
              <Button
                type="button"
                size="icon"
                disabled={!typed}
                tabIndex={-1}
                aria-label="Send example question"
                className="shrink-0"
              >
                <Send size={17} />
              </Button>
            </div>
            <p className="mt-2 text-center text-xs text-ink-faint">
              Answers are synthesized exclusively from archived CCSICT theses. Topics ≥85% similar to existing work are flagged for faculty review.
            </p>
          </div>
        </GlassCard>
      </Reveal>

      <p className="mx-auto mt-6 max-w-md text-center text-xs leading-relaxed text-ink-faint">
        A scripted preview. The real thing answers from the live CCSICT archive —{' '}
        <span className="font-semibold">no account needed to try it.</span>
      </p>
    </section>
  )
}
