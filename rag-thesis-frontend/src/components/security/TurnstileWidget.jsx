import { useEffect, useRef } from 'react'
import { usePreferences } from '../../context/PreferencesContext'
import { cn } from '../../lib/utils'
import { TURNSTILE_SITE_KEY, turnstileEnabled } from './turnstileConfig'

const SCRIPT_ID = 'cloudflare-turnstile-script'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/**
 * Statuses reported through `onStatus`:
 *   pending      challenge running; nothing for the visitor to do
 *   interactive  Cloudflare needs a click, so the widget has become visible
 *   solved       a token was issued
 *   expired      the token aged out; Turnstile refreshes itself
 *   error        network or challenge failure, retryable
 *   unsupported  this browser cannot run the challenge at all
 */

let pendingLoad = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (pendingLoad) return pendingLoad
  pendingLoad = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID)
    const script = existing || document.createElement('script')
    script.addEventListener(
      'load',
      () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable'))),
      { once: true },
    )
    script.addEventListener('error', () => reject(new Error('Turnstile unavailable')), { once: true })
    if (existing) return
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    document.head.appendChild(script)
  })
  // A blocked or flaky CDN must not poison later attempts, so drop the cached
  // promise and the dead tag to let the next mount retry from scratch.
  pendingLoad.catch(() => {
    pendingLoad = null
    document.getElementById(SCRIPT_ID)?.remove()
  })
  return pendingLoad
}

export function TurnstileWidget({
  action,
  onToken,
  onStatus,
  resetKey = 0,
  appearance = 'interaction-only',
  className,
}) {
  const containerRef = useRef(null)
  const { isDark } = usePreferences()
  // Callbacks are read through refs so that a parent re-render never tears down
  // a challenge that is already in flight.
  const onTokenRef = useRef(onToken)
  const onStatusRef = useRef(onStatus)

  useEffect(() => {
    onTokenRef.current = onToken
    onStatusRef.current = onStatus
  })

  useEffect(() => {
    if (!turnstileEnabled) return undefined
    const container = containerRef.current
    if (!container) return undefined

    let disposed = false
    let widgetId
    const emitToken = (token) => { if (!disposed) onTokenRef.current?.(token) }
    const emitStatus = (status) => { if (!disposed) onStatusRef.current?.(status) }

    emitToken(null)
    emitStatus('pending')

    loadTurnstile().then((turnstile) => {
      if (disposed) return
      widgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        appearance,
        size: 'flexible',
        // Turnstile cannot restyle in place, and the app's dark mode is a class
        // rather than a media query, so 'auto' would follow the OS instead.
        theme: isDark ? 'dark' : 'light',
        language: document.documentElement.lang || 'en',
        callback: (token) => { emitToken(token); emitStatus('solved') },
        'expired-callback': () => { emitToken(null); emitStatus('expired') },
        'timeout-callback': () => { emitToken(null); emitStatus('expired') },
        'error-callback': () => { emitToken(null); emitStatus('error') },
        'unsupported-callback': () => { emitToken(null); emitStatus('unsupported') },
        'before-interactive-callback': () => emitStatus('interactive'),
        'after-interactive-callback': () => emitStatus('pending'),
      })
    }).catch(() => {
      emitToken(null)
      emitStatus('error')
    })

    return () => {
      disposed = true
      if (widgetId !== undefined) window.turnstile?.remove(widgetId)
    }
  }, [action, appearance, isDark, resetKey])

  if (!turnstileEnabled) return null
  // No reserved height: under 'interaction-only' the slot stays collapsed for
  // visitors who never see a challenge.
  return (
    <div
      ref={containerRef}
      className={cn('w-full empty:hidden', className)}
      aria-label="Security verification"
    />
  )
}
