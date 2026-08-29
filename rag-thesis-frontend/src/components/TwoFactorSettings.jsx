import { useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { Button } from './ui/Button'
import { MfaEnrollDialog } from './MfaEnrollDialog'
import { useMfaStatus } from './useMfaStatus'

/**
 * 2FA management row for Settings → Security. Enrollment and removal both
 * happen in the MfaEnrollDialog this row opens.
 */
export function TwoFactorSettings() {
  const [open, setOpen] = useState(false)
  const { enabled, handleChanged } = useMfaStatus()

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={
              enabled
                ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-md shadow-forest-900/25'
                : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-900/8 dark:bg-white/8'
            }
          >
            <Fingerprint size={16} className={enabled ? 'text-gold-300' : 'opacity-50'} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              Authenticator app (2FA)
              <span
                className={
                  enabled
                    ? 'inline-flex items-center gap-1 rounded-full bg-forest-500/12 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-forest-700 dark:text-forest-300'
                    : 'inline-flex items-center gap-1 rounded-full bg-forest-900/8 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted dark:bg-white/8'
                }
              >
                <span className={enabled ? 'h-1 w-1 rounded-full bg-forest-500' : 'h-1 w-1 rounded-full bg-forest-900/30 dark:bg-white/30'} />
                {enabled ? 'On' : 'Off'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {enabled
                ? 'Sign-ins require your password and a rotating authenticator code.'
                : 'A stolen password alone can never open your account — takes about a minute.'}
            </p>
          </div>
        </div>
        <Button
          variant={enabled ? 'outline' : 'primary'}
          size="sm"
          className="shrink-0"
          onClick={() => setOpen(true)}
        >
          {enabled ? 'Manage' : 'Enable 2FA'}
        </Button>
      </div>
      <MfaEnrollDialog open={open} onClose={() => setOpen(false)} onChanged={handleChanged} />
    </div>
  )
}
