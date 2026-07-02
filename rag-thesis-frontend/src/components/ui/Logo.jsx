import { cn } from '../../lib/utils'

export function Logo({ size = 40, className, glow = false }) {
  return (
    <img
      src="/isu-logo.jpg"
      alt="Isabela State University seal"
      width={size}
      height={size}
      className={cn(
        'rounded-full object-cover ring-2 ring-gold-400/40',
        glow && 'shadow-[0_0_30px_rgba(242,169,0,0.35)]',
        className,
      )}
    />
  )
}

export function BrandMark({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <Logo size={compact ? 34 : 40} />
      {!compact && (
        <div className="leading-tight">
          <div className="font-display text-[0.95rem] font-extrabold tracking-tight">
            ISU Thesis <span className="text-gradient-gold">AI</span> Library
          </div>
          <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] opacity-55">
            CCSICT · Echague
          </div>
        </div>
      )}
    </div>
  )
}
