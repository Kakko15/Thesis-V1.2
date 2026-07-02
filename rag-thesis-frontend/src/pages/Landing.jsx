import { LandingNav } from './landing/LandingNav'
import { Hero } from './landing/Hero'
import { StatsStrip } from './landing/StatsStrip'
import { HowItWorks } from './landing/HowItWorks'
import { AskDemo } from './landing/AskDemo'
import { TracksMarquee } from './landing/TracksMarquee'
import { BentoFeatures } from './landing/BentoFeatures'
import { Audiences } from './landing/Audiences'
import { FinalCTA } from './landing/FinalCTA'
import { Footer } from './landing/Footer'

/**
 * Public marketing page. Section components live in ./landing/ — one file
 * each; the 3D hero scene is lazy-loaded inside <Hero /> so the three.js
 * chunk never blocks the initial paint.
 */
export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <LandingNav />
      <main>
        <Hero />
        <StatsStrip />
        <HowItWorks />
        <AskDemo />
        <TracksMarquee />
        <BentoFeatures />
        <Audiences />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
