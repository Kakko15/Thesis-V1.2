import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { GlassCard } from '../../components/ui/GlassCard'
import { Logo } from '../../components/ui/Logo'
import { Magnetic, Reveal } from '../../components/ui/Motion'

export function FinalCTA() {
  const navigate = useNavigate()
  return (
    <section className="relative px-6 pb-10 pt-24">
      <Reveal>
        <GlassCard strong className="relative mx-auto max-w-4xl overflow-hidden p-10 text-center sm:p-16">
          <div className="absolute inset-0 bg-gradient-to-br from-forest-700/90 to-forest-900/95" />
          {/* Faint grid + gold aurora inside the panel */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 78%)',
            }}
          />
          <div className="absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-gold-400/20 blur-3xl" />

          <div className="relative">
            <Logo size={64} glow className="mx-auto mb-6" />
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Your next thesis starts with a{' '}
              <em className="font-accent text-gradient-gold">question</em>
              <span className="text-gold-300">.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Join the students and advisers of ISU Echague already researching at the speed of
              thought.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Magnetic>
                <Button size="xl" variant="gold" onClick={() => navigate('/login')} className="group">
                  Get started free
                  <ArrowRight
                    size={17}
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </Button>
              </Magnetic>
              <Magnetic strength={0.2}>
                <Button
                  size="xl"
                  variant="ghost"
                  className="text-white hover:bg-white/10"
                  onClick={() => navigate('/chat')}
                >
                  Explore as guest
                </Button>
              </Magnetic>
            </div>
          </div>
        </GlassCard>
      </Reveal>
    </section>
  )
}
