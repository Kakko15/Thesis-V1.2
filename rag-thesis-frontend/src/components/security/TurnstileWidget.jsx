import { useEffect, useId, useRef } from 'react'
import { TURNSTILE_SITE_KEY, turnstileEnabled } from './turnstileConfig'

const SCRIPT_ID = 'cloudflare-turnstile-script'

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID)
    const ready = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile unavailable'))
    if (existing) {
      if (existing.dataset.failed === 'true') {
        existing.remove()
        resolve(loadTurnstile())
        return
      }
      existing.addEventListener('load', ready, { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile unavailable')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.addEventListener('load', ready, { once: true })
    script.addEventListener('error', () => {
      script.dataset.failed = 'true'
      reject(new Error('Turnstile unavailable'))
    }, { once: true })
    document.head.appendChild(script)
  })
}

export function TurnstileWidget({ action, onToken, resetKey = 0 }) {
  const id = useId().replaceAll(':', '')
  const containerRef = useRef(null)

  useEffect(() => {
    if (!turnstileEnabled) return undefined
    let disposed = false
    let widgetId
    onToken(null)
    loadTurnstile().then((turnstile) => {
      if (disposed || !containerRef.current) return
      widgetId = turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        theme: 'auto',
        size: 'flexible',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      })
    }).catch(() => onToken(null))
    return () => {
      disposed = true
      if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [action, id, onToken, resetKey])

  if (!turnstileEnabled) return null
  return <div ref={containerRef} id={`turnstile-${id}`} className="min-h-[65px] w-full" aria-label="Security verification" />
}
