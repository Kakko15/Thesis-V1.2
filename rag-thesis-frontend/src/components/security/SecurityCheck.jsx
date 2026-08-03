import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TurnstileWidget } from './TurnstileWidget'
import { turnstileEnabled } from './turnstileConfig'

const EASE = [0.2, 0, 0, 1]

// Statuses that mean the visitor is blocked and therefore always deserve chrome,
// even for `quiet` callers that stay silent through a clean pass.
const BLOCKING = new Set(['interactive', 'expired', 'error', 'unsupported'])

const PRESENTATION = {
  pending: { icon: Loader2, tone: 'neutral', spin: true, headline: 'Checking your browser' },
  interactive: { icon: ShieldAlert, tone: 'gold', headline: 'Confirm you are human' },
  solved: { icon: ShieldCheck, tone: 'forest', headline: 'Verified' },
  expired: { icon: RefreshCw, tone: 'gold', spin: true, headline: 'Check expired' },
  error: { icon: ShieldAlert, tone: 'flame', retry: true, headline: 'Could not verify' },
  unsupported: { icon: ShieldAlert, tone: 'flame', headline: 'Security check unavailable' },
}

const TONE_TEXT = {
  neutral: 'text-[var(--muted-foreground)]',
  gold: 'text-gold-700 dark:text-gold-300',
  forest: 'text-forest-700 dark:text-forest-300',
  flame: 'text-flame-600 dark:text-flame-400',
}

const TONE_BADGE = {
  neutral: 'bg-[var(--surface-2)]',
  gold: 'bg-gold-400/20',
  forest: 'bg-forest-500/15',
  flame: 'bg-flame-500/15',
}

const TONE_PANEL = {
  neutral: 'border-[var(--border)] bg-[var(--surface-1)]',
  gold: 'border-gold-400/25 bg-gold-400/[0.07]',
  forest: 'border-forest-500/20 bg-forest-500/[0.06]',
  flame: 'border-flame-500/25 bg-flame-500/[0.06]',
}

function bodyFor(status, description) {
  switch (status) {
    case 'expired':
      return 'That check timed out. A fresh one is already starting.'
    case 'error':
      return 'Check your connection, then try again.'
    case 'unsupported':
      return 'Try another browser, or allow challenges.cloudflare.com.'
    default:
      return description
  }
}

function StatusIcon({ view, isPanel }) {
  const Icon = view.icon
  const spin = view.spin && 'animate-spin'
  if (!isPanel) {
    return <Icon size={12} aria-hidden="true" className={cn('shrink-0', TONE_TEXT[view.tone], spin)} />
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
        TONE_BADGE[view.tone],
        TONE_TEXT[view.tone],
      )}
    >
      <Icon size={15} className={cn(spin)} />
    </span>
  )
}

function StatusRow({ status, view, isPanel, headline, body, onRetry }) {
  return (
    <motion.div
      key={status}
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      // The inline row shrinks to its content so callers can centre it with a
      // plain `text-center`; the panel row always spans its frame.
      className={cn('items-center', isPanel ? 'flex gap-3' : 'inline-flex gap-2 text-left')}
      aria-live="polite"
    >
      <StatusIcon view={view} isPanel={isPanel} />

      <div className={cn('min-w-0', isPanel && 'flex-1')}>
        <p className={cn('font-bold leading-snug', isPanel ? 'text-xs' : 'text-xs', TONE_TEXT[view.tone])}>
          {headline}
        </p>
        {isPanel && body && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{body}</p>}
      </div>

      {view.retry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn('state-layer shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold', TONE_TEXT[view.tone])}
        >
          Try again
        </button>
      )}
    </motion.div>
  )
}

/**
 * Presentation shell around Turnstile. The challenge runs invisibly for the vast
 * majority of visitors, so the widget slot is only given room once Cloudflare
 * actually asks for an interaction, and `quiet` callers show nothing at all
 * while a check passes on its own.
 */
export function SecurityCheck({
  action,
  onToken,
  onStatusChange,
  resetKey = 0,
  variant = 'panel',
  title,
  description,
  quiet = false,
  className,
}) {
  const [status, setStatus] = useState('pending')
  const [retryNonce, setRetryNonce] = useState(0)
  const onStatusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  })

  const handleStatus = useCallback((next) => {
    setStatus(next)
    onStatusChangeRef.current?.(next)
  }, [])

  if (!turnstileEnabled) return null

  const view = PRESENTATION[status] ?? PRESENTATION.pending
  const isPanel = variant === 'panel'
  // The inline variant has no frame to caption, and Cloudflare's own widget
  // already says "verify you are human", so stay out of its way once visible.
  const silentInteraction = !isPanel && status === 'interactive'
  const revealed = (!quiet || BLOCKING.has(status)) && !silentInteraction

  return (
    <div
      data-security-status={status}
      className={cn(
        'transition-[padding,background-color,border-color] duration-300',
        // Collapsed callers must cost zero height, so the caller's spacing and
        // the panel frame only land once there is something worth showing.
        revealed && isPanel && cn('rounded-2xl border px-4 py-3', TONE_PANEL[view.tone]),
        revealed && className,
      )}
    >
      {revealed && (
        <StatusRow
          status={status}
          view={view}
          isPanel={isPanel}
          headline={status === 'interactive' && title ? title : view.headline}
          body={bodyFor(status, description)}
          onRetry={() => setRetryNonce((nonce) => nonce + 1)}
        />
      )}

      <TurnstileWidget
        action={action}
        onToken={onToken}
        onStatus={handleStatus}
        resetKey={resetKey + retryNonce}
        className={cn(status === 'interactive' && revealed && (isPanel ? 'mt-3' : 'mt-2'))}
      />
    </div>
  )
}
