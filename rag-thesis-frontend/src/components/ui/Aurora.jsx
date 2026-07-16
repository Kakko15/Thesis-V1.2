import { cn } from '../../lib/utils'

/**
 * GPU-friendly animated aurora mesh in the ISU colorway.
 * Pure transforms + blur — no layout thrash, 60fps.
 */
export function Aurora({ className, subtle = false }) {
  return (
    <div aria-hidden className={cn('effects-decorative pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        className={cn(
          'absolute -top-1/4 -left-1/4 h-[70vmax] w-[70vmax] rounded-full blur-[120px] animate-aurora will-change-transform',
          subtle ? 'opacity-20' : 'opacity-35',
        )}
        style={{ background: 'radial-gradient(circle at 30% 30%, #046a38 0%, transparent 65%)' }}
      />
      <div
        className={cn(
          'absolute -bottom-1/4 -right-1/4 h-[60vmax] w-[60vmax] rounded-full blur-[110px] animate-aurora will-change-transform',
          subtle ? 'opacity-15' : 'opacity-28',
        )}
        style={{
          background: 'radial-gradient(circle at 70% 70%, #f2a900 0%, transparent 60%)',
          animationDelay: '-8s',
          animationDirection: 'alternate-reverse',
        }}
      />
      <div
        className={cn(
          'absolute top-1/3 left-1/2 h-[45vmax] w-[45vmax] rounded-full blur-[130px] animate-aurora will-change-transform',
          subtle ? 'opacity-10' : 'opacity-20',
        )}
        style={{
          background: 'radial-gradient(circle at 50% 50%, #10b96c 0%, transparent 60%)',
          animationDelay: '-16s',
        }}
      />
      <div className="bg-noise absolute inset-0" />
    </div>
  )
}
