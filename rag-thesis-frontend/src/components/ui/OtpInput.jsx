import { useRef } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

/**
 * Segmented one-time-code input.
 * - `value` is a contiguous digit string (controlled)
 * - auto-advance, backspace/arrow navigation, full-code paste & OS autofill
 * - `onComplete(code)` fires when all boxes are filled
 * - bump `shakeNonce` to play the error shake
 */
export function OtpInput({
  length = 6,
  value = '',
  onChange,
  onComplete,
  disabled = false,
  error = false,
  shakeNonce = 0,
  autoFocus = true,
  ariaLabel = 'Verification code',
}) {
  const refs = useRef([])
  const chars = Array.from({ length }, (_, i) => value[i] ?? '')

  const focusIndex = (i) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus()

  const commit = (next) => {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange?.(clean)
    if (clean.length === length) onComplete?.(clean)
  }

  const handleChange = (i, e) => {
    if (disabled) return
    const inserted = e.nativeEvent?.data ?? e.target.value.slice(-1)
    const digits = String(inserted ?? '').replace(/\D/g, '')
    if (!digits) {
      // deletion via input event
      commit(value.slice(0, i) + value.slice(i + 1))
      return
    }
    if (digits.length > 1) {
      // OS/keychain autofill or multi-char insert — treat as full paste
      commit(digits)
      focusIndex(digits.length - 1)
      return
    }
    const next = (value.slice(0, i) + digits + value.slice(i + 1)).slice(0, length)
    commit(next)
    focusIndex(i + 1)
  }

  const handleKeyDown = (i, e) => {
    if (disabled) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (!value) return
      const cut = i < value.length ? i : value.length - 1
      commit(value.slice(0, cut) + value.slice(cut + 1))
      focusIndex(cut)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusIndex(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusIndex(i + 1)
    } else if (e.key === 'Enter' && value.length === length) {
      onComplete?.(value)
    }
  }

  const handlePaste = (e) => {
    if (disabled) return
    e.preventDefault()
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length)
    if (!digits) return
    commit(digits)
    focusIndex(digits.length - 1)
  }

  return (
    <motion.div
      key={shakeNonce}
      animate={shakeNonce ? { x: [0, -9, 9, -6, 6, -2, 0] } : false}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      role="group"
      aria-label={ariaLabel}
      onPaste={handlePaste}
      className="flex justify-center gap-2 sm:gap-2.5"
    >
      {chars.map((char, i) => (
        <motion.input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          initial={{ opacity: 0, y: 14, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.05 + i * 0.045, type: 'spring', stiffness: 360, damping: 26 }}
          value={char}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1} of ${length}`}
          className={cn(
            'h-14 w-11 rounded-2xl border bg-white/60 text-center font-mono text-xl font-bold outline-none backdrop-blur-xl transition-all duration-200 sm:w-12',
            'border-forest-900/15 dark:border-white/12 dark:bg-white/[0.05]',
            'focus:scale-[1.05] focus:border-gold-400 focus:ring-4 focus:ring-gold-400/15',
            char && !error && 'border-forest-500/60 dark:border-forest-400/60',
            error && 'border-flame-500 focus:border-flame-500 focus:ring-flame-500/15 dark:border-flame-500',
            disabled && 'opacity-50',
          )}
        />
      ))}
    </motion.div>
  )
}
