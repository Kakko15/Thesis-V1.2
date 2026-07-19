import { Link } from 'react-router-dom'
import { BrandMark } from '../../components/ui/Logo'

const EXPLORE_LINKS = [
  { label: 'Try as Guest Researcher', to: '/chat' },
  { label: 'Sign in', to: '/login' },
  { label: 'The pipeline', href: '#pipeline' },
  { label: 'Live demo', href: '#demo' },
  { label: 'Features', href: '#features' },
]

const linkClass =
  'text-sm opacity-60 transition hover:opacity-100 hover:text-forest-600 dark:hover:text-gold-300'

export function Footer() {
  return (
    <footer className="relative border-t border-forest-900/10 px-6 py-14 dark:border-white/10">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        {/* Brand */}
        <div>
          <BrandMark />
          <p className="mt-4 max-w-sm text-xs leading-relaxed opacity-50">
            A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation —
            preserving and unlocking the research memory of CCSICT.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-forest-500/10 px-3 py-1.5 font-mono text-[0.65rem] font-semibold text-forest-700 dark:text-forest-300">
            RAG · Gemini · pgvector
          </div>
        </div>

        {/* Explore */}
        <nav aria-label="Explore">
          <h4 className="font-display mb-4 text-sm font-bold uppercase tracking-wider opacity-70">
            Explore
          </h4>
          <ul className="space-y-2.5">
            {EXPLORE_LINKS.map((link) => (
              <li key={link.label}>
                {link.to ? (
                  <Link to={link.to} className={linkClass}>
                    {link.label}
                  </Link>
                ) : (
                  <a href={link.href} className={linkClass}>
                    {link.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>

        {/* Institution */}
        <div>
          <h4 className="font-display mb-4 text-sm font-bold uppercase tracking-wider opacity-70">
            Institution
          </h4>
          <ul className="space-y-2.5 text-sm opacity-60">
            <li>College of Computing Studies, Information and Communication Technology</li>
            <li>Isabela State University</li>
            <li>Echague, Isabela</li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-forest-900/10 pt-6 text-xs opacity-45 dark:border-white/10 sm:flex-row">
        <span>© {new Date().getFullYear()} Isabela State University · Est. 1978</span>
        <span>Built by CCSICT, for CCSICT.</span>
      </div>
    </footer>
  )
}
