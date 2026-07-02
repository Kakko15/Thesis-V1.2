import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { RotateCcw, Sparkles, User } from 'lucide-react'
import { GlassCard } from '../../components/ui/GlassCard'
import { Button } from '../../components/ui/Button'
import { Reveal } from '../../components/ui/Motion'
import { SectionHeading } from './SectionHeading'
import { cn } from '../../lib/utils'

/* Fully scripted product demo — no API calls. Phases:
   0 idle · 1 typing question · 2 thinking · 3 streaming answer · 4 sources */

const QUESTION = 'What local studies used CNNs for crop disease detection?'
const ANSWER_WORDS =
  'Two archived studies applied convolutional neural networks to agricultural imagery [1] [2] — both within the Data Mining track. The 2023 study reached 94% accuracy detecting rice-leaf blight, while the 2021 work classified maize diseases from smartphone photos.'.split(' ')
const SOURCES = [
  { n: 1, title: 'CNN-Based Rice Leaf Disease Detection', meta: 'Data Mining · 2023' },
  { n: 2, title: 'Maize Disease Image Classification', meta: 'Data Mining · 2021' },
]

const TYPE_MS = 26
const THINK_MS = 1000
const WORD_MS = 42

const wordVariant = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
}

const isCitation = (word) => /^\[\d+\]$/.test(word)

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1.5" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-forest-500 dark:bg-forest-300"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  )
}

export function AskDemo() {
  const reduced = useReducedMotion()
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-120px' })
  const [runId, setRunId] = useState(0)
  const [phase, setPhase] = useState(0)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!inView) return undefined
    const timers = []
    if (reduced) {
      // Skip the animation: jump straight to the final frame.
      timers.push(
        setTimeout(() => {
          setTyped(QUESTION)
          setPhase(4)
        }, 0),
      )
      return () => timers.forEach(clearTimeout)
    }
    let i = 0
    const typeNext = () => {
      i += 1
      setTyped(QUESTION.slice(0, i))
      if (i < QUESTION.length) {
        timers.push(setTimeout(typeNext, TYPE_MS))
      } else {
        timers.push(setTimeout(() => setPhase(2), 350))
        timers.push(setTimeout(() => setPhase(3), 350 + THINK_MS))
        timers.push(
          setTimeout(() => setPhase(4), 350 + THINK_MS + ANSWER_WORDS.length * WORD_MS + 500),
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
        <GlassCard strong className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-[2rem]">
          {/* Title bar */}
          <div className="flex items-center justify-between border-b border-forest-900/10 px-5 py-3 dark:border-white/10">
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-flame-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-gold-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-forest-500/70" />
            </div>
            <span className="font-mono text-[0.65rem] uppercase tracking-wider opacity-50">
              Guest session · CCSICT archive
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Replay the demo" onClick={replay}>
              <RotateCcw size={14} />
            </Button>
          </div>

          {/* Conversation */}
          <div className="min-h-[23rem] space-y-5 p-5 sm:p-7">
            {/* User bubble */}
            {phase >= 1 && (
              <div className="flex items-start justify-end gap-3">
                <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-gradient-to-br from-forest-600 to-forest-800 px-4 py-3 text-sm text-white shadow-lg shadow-forest-900/20">
                  {typed}
                  {phase === 1 && (
                    <span className="animate-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-gold-300" />
                  )}
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-400">
                  <User size={14} className="text-forest-950" />
                </span>
              </div>
            )}

            {/* AI bubble */}
            {phase >= 2 && (
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800">
                  <Sparkles size={14} className="text-gold-300" />
                </span>
                <div className="glass max-w-[85%] rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed">
                  {phase === 2 ? (
                    <ThinkingDots />
                  ) : (
                    <motion.span
                      key={runId}
                      initial="hidden"
                      animate="show"
                      transition={{ staggerChildren: WORD_MS / 1000 }}
                    >
                      {ANSWER_WORDS.map((word, i) =>
                        isCitation(word) ? (
                          <motion.span
                            key={i}
                            variants={wordVariant}
                            className="mx-0.5 inline-block rounded-md bg-gold-400/20 px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-gold-600 dark:text-gold-300"
                          >
                            {word}
                          </motion.span>
                        ) : (
                          <motion.span key={i} variants={wordVariant} className="inline">
                            {word}{' '}
                          </motion.span>
                        ),
                      )}
                    </motion.span>
                  )}
                </div>
              </div>
            )}

            {/* Source cards */}
            {phase >= 4 && (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
                className="grid gap-2.5 pl-11 sm:grid-cols-2"
              >
                {SOURCES.map((source, i) => (
                  <motion.div
                    key={source.n}
                    initial={reduced ? false : { opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.15 + i * 0.12, type: 'spring', stiffness: 320, damping: 24 }}
                    className={cn('glass flex items-start gap-2.5 rounded-xl px-3.5 py-3')}
                  >
                    <span className="mt-0.5 rounded-md bg-gold-400/20 px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold text-gold-600 dark:text-gold-300">
                      [{source.n}]
                    </span>
                    <span>
                      <span className="block text-xs font-bold leading-snug">{source.title}</span>
                      <span className="mt-0.5 block text-[0.65rem] opacity-55">{source.meta}</span>
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </GlassCard>
      </Reveal>

      <p className="mx-auto mt-6 max-w-md text-center text-xs leading-relaxed opacity-45">
        A scripted preview. The real thing answers from the live CCSICT archive —{' '}
        <span className="font-semibold">no account needed to try it.</span>
      </p>
    </section>
  )
}
