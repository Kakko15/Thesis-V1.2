import { Link } from 'react-router'
import { BrandMark } from '../../components/ui/Logo'

/** lucide-react no longer ships brand icons, so the official Facebook mark is
    inline: brand blue (#1877F2) circle with the knocked-out "f" over white. */
function FacebookIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#fff" />
      <path
        fill="#1877F2"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </svg>
  )
}

const EXPLORE_LINKS = [
  { label: 'Try as Guest Researcher', to: '/chat' },
  { label: 'Sign in', to: '/login' },
  { label: 'The pipeline', href: '#pipeline' },
  { label: 'Live demo', href: '#demo' },
  { label: 'Features', href: '#features' },
]

const linkClass =
  'text-sm text-ink-muted transition hover:text-forest-700 dark:hover:text-gold-300'

export function Footer() {
  return (
    <footer className="relative border-t border-forest-900/10 px-6 py-14 dark:border-white/10">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
        {/* Brand */}
        <div>
          <BrandMark />
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-faint">
            A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation —
            preserving and unlocking the research memory of CCSICT.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-forest-500/10 px-3 py-1.5 font-mono text-xs font-semibold text-forest-700 dark:text-forest-300">
            RAG · Gemini · pgvector
          </div>
          <div className="mt-4 flex items-center gap-3">
            <a
              href="https://www.facebook.com/ISUsystem"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Isabela State University on Facebook"
              className="transition hover:opacity-75"
            >
              <FacebookIcon />
            </a>
            <a
              href="https://isu.edu.ph/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Isabela State University website"
              className="transition hover:opacity-75"
            >
              <img
                src="/isu-logo.jpg"
                alt=""
                className="h-8 w-8 rounded-full bg-white object-cover ring-1 ring-forest-900/10 dark:ring-white/15"
              />
            </a>
          </div>
        </div>

        {/* Explore */}
        <nav aria-label="Explore">
          {/* h3, not h4: the last heading before the footer is FinalCTA's h2, so
              h4 skipped a level. Visual size is set by the class, not the tag. */}
          <h3 className="font-display mb-4 text-sm font-bold uppercase tracking-wider text-ink-muted">
            Explore
          </h3>
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
          <h3 className="font-display mb-4 text-sm font-bold uppercase tracking-wider text-ink-muted">
            Institution
          </h3>
          <ul className="space-y-2.5 text-sm text-ink-muted">
            <li>College of Computing Studies, Information and Communication Technology</li>
            <li>Isabela State University</li>
            <li>Echague, Isabela</li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-forest-900/10 pt-6 text-xs text-ink-faint dark:border-white/10 sm:flex-row">
        <span>© {new Date().getFullYear()} Isabela State University · Est. 1978</span>
        <span>Built by CCSICT, for CCSICT.</span>
      </div>
    </footer>
  )
}
