import { motion } from 'framer-motion'
import { usePreferences } from '../../context/PreferencesContext'
import { cn } from '../../lib/utils'

const leftPage = 'M6 18.2c0-3 2.5-5.3 5.5-5 7.8.7 14.2 3.6 19.1 8.5v33.1c-5-4.3-11.5-6.8-19.4-7.4A5.7 5.7 0 0 1 6 41.8V18.2Z'
const rightPage = 'M58 18.2c0-3-2.5-5.3-5.5-5-7.8.7-14.2 3.6-19.1 8.5v33.1c5-4.3 11.5-6.8 19.4-7.4a5.7 5.7 0 0 0 5.2-5.6V18.2Z'
const pageLines = 'M12.5 29.2c0-1 .9-1.8 1.9-1.6 4.1.6 7.8 2 11 4.3.7.5.9 1.5.4 2.2-.5.7-1.5.9-2.2.4a25.5 25.5 0 0 0-9.7-3.8c-.8-.1-1.4-.7-1.4-1.5ZM51.5 29.2c0-1-.9-1.8-1.9-1.6-4.1.6-7.8 2-11 4.3-.7.5-.9 1.5-.4 2.2.5.7 1.5.9 2.2.4a25.5 25.5 0 0 1 9.7-3.8c.8-.1 1.4-.7 1.4-1.5Z'
const intelligenceSpark = 'M32 4.5c.7 0 1.3.5 1.5 1.1l2.3 6.7c.2.7.8 1.3 1.5 1.5l6.7 2.3c1.5.5 1.5 2.7 0 3.2l-6.7 2.3c-.7.2-1.3.8-1.5 1.5l-2.3 6.7c-.5 1.5-2.7 1.5-3.2 0L28 23.1c-.2-.7-.8-1.3-1.5-1.5l-6.7-2.3c-1.5-.5-1.5-2.7 0-3.2l6.7-2.3c.7-.2 1.3-.8 1.5-1.5l2.3-6.7c.2-.6.8-1.1 1.5-1.1h.2Z'

export function AnimatedLogo({ size = 40, className }) {
  const { reducedMotion, effects } = usePreferences()
  const active = !reducedMotion && effects !== 'low'

  return (
    <div
      aria-hidden="true"
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <motion.svg
        viewBox="0 0 64 64"
        fill="none"
        className="relative h-full w-full overflow-visible"
      >
        <motion.path
          d={leftPage}
          fill="#046A38"
          style={{ transformBox: 'fill-box', transformOrigin: 'bottom right' }}
          animate={active ? { rotate: [0, -4, 1, 0], scaleX: [1, 0.94, 1.02, 1] } : undefined}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d={rightPage}
          fill="#10B96C"
          style={{ transformBox: 'fill-box', transformOrigin: 'bottom left' }}
          animate={active ? { rotate: [0, 4, -1, 0], scaleX: [1, 0.94, 1.02, 1] } : undefined}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d={pageLines}
          fill="#F8FAF6"
          animate={active ? { opacity: [0.35, 1, 0.35] } : { opacity: 0.82 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d={intelligenceSpark}
          fill="#F2A900"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={active ? {
            rotate: [0, 45, 90],
            scale: [0.9, 1.18, 0.9],
            filter: [
              'drop-shadow(0 0 0 rgba(242,169,0,0))',
              'drop-shadow(0 0 7px rgba(242,169,0,0.9))',
              'drop-shadow(0 0 0 rgba(242,169,0,0))',
            ],
          } : undefined}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.circle
          cx="15"
          cy="39"
          r="2"
          fill="#FFC72C"
          animate={active ? { opacity: [0.25, 1, 0.25], scale: [0.7, 1.35, 0.7] } : undefined}
          transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
        <motion.circle
          cx="49"
          cy="39"
          r="2"
          fill="#FFC72C"
          animate={active ? { opacity: [1, 0.25, 1], scale: [1.35, 0.7, 1.35] } : undefined}
          transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      </motion.svg>
    </div>
  )
}
