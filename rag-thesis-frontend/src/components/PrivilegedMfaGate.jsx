import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { MfaEnrollDialog } from './MfaEnrollDialog'
import { useMfaStatus } from './useMfaStatus'

/**
 * Recovery for the one refusal a signed-in reader can clear themselves.
 *
 * Supabase raises a session to `aal2` only through an authenticator challenge.
 * Verifying by emailed code proves a second step to this app and leaves the
 * access token at `aal1`, so a privileged account arrives inside the shell
 * with every privileged endpoint closed to it — novelty scanning, uploads and
 * the admin dashboard alike — and nothing on screen saying why.
 *
 * When the API says so, `AuthContext` retires that app-level pass. An account
 * with a verified factor is then returned to the ordinary sign-in challenge by
 * `ProtectedRoute`. An account with no factor at all has nowhere to be sent,
 * which is the case this handles: enrolling here runs `challengeAndVerify`,
 * which upgrades the live session, so the reader never loses their place.
 */
export function PrivilegedMfaGate() {
  const { privilegedMfaRequired } = useAuth()
  // Nothing is read, and no factor lookup is issued, until the API has
  // actually refused this session — the quiet case must cost every other
  // page load nothing.
  if (!privilegedMfaRequired) return null
  return <StrandedSessionPrompt />
}

function StrandedSessionPrompt() {
  const { enabled, isLoading, handleChanged } = useMfaStatus()
  const { signOut } = useAuth()
  const [enrolling, setEnrolling] = useState(false)
  const queryClient = useQueryClient()

  // With a factor already verified, the sign-in challenge is the right place
  // for this and the redirect is already under way — don't talk over it.
  const stranded = !isLoading && !enabled

  const onEnrolled = async () => {
    await handleChanged()
    // The screens that were refused hold failed queries; the session can serve
    // them now, so let them ask again rather than leaving stale error panels.
    queryClient.invalidateQueries()
  }

  return (
    <>
      <Modal
        open={stranded && !enrolling}
        onClose={() => {}}
        title="Two-factor authentication required"
        description="Your account holds privileges this session cannot use yet."
        size="sm"
      >
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-3 rounded-xl bg-flame-500/10 p-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <p className="leading-relaxed">
              You verified this sign-in with an emailed code. That confirms your
              address, but it is not a second factor the server can check, so
              novelty scanning, uploads and administration stay closed.
            </p>
          </div>
          <p className="leading-relaxed text-ink-muted">
            Set up an authenticator app to finish. It takes about a minute, and
            this session unlocks straight away — you will not lose your place.
          </p>
          <div className="space-y-2">
            <Button className="w-full" onClick={() => setEnrolling(true)}>
              Set up authenticator
            </Button>
            {/* The prompt is not dismissible, because dismissing it would only
                restore the silent version of the same dead end. Signing out is
                the honest way past it for someone without their phone. */}
            <Button variant="ghost" className="w-full" onClick={signOut}>
              Sign out instead
            </Button>
          </div>
        </div>
      </Modal>

      <MfaEnrollDialog
        open={enrolling}
        onClose={() => setEnrolling(false)}
        onChanged={onEnrolled}
      />
    </>
  )
}
