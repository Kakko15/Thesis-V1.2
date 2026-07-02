import { ArrowLeft } from 'lucide-react'

/** Icon badge + title/subtitle lockup shared by every auth step. */
export function StepHeader({ icon: Icon, title, subtitle, onBack, backLabel = 'Back' }) {
  return (
    <div className="mb-7">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold opacity-50 transition-opacity hover:opacity-100"
        >
          <ArrowLeft size={13} /> {backLabel}
        </button>
      )}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-lg shadow-forest-900/25">
          <Icon size={21} className="text-gold-300" />
        </div>
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm leading-relaxed opacity-60">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}
