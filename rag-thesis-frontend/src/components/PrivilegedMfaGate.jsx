import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { shouldPromptForPrivilegedMfa } from '../lib/privilegedMfa.js'
import { MfaChallengeStep } from '../pages/auth/MfaChallengeStep'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { MfaEnrollDialog } from './MfaEnrollDialog'
import { useMfaStatus } from './useMfaStatus'

/**
 * Recovery, in place, for the one refusal a signed-in reader can clear alone.
 *
 * Supabase raises a session to `aal2` only through an authenticator challenge.
 * Verifying by emailed code proves a second step to this app and leaves the
 * access token at `aal1`, so a privileged account arrives inside the shell
 * with every privileged endpoint closed to it — novelty scanning, uploads and
 * the admin dashboard alike — and nothing on screen saying why.
 *
 * The factor is collected here rather than by returning anyone to /login. That
 * route offers the emailed code again, which mints another `aal1` session and
 * leads straight back to the same refusal: a loop, and one that costs the
 * reader the page they were on each time round. Whichever recovery applies,
 * it upgrades the live session, so nobody signs in twice.
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
  const { privilegedMfaRefusals, signOut } = useAuth()
  const { enabled, isLoading, handleChanged } = useMfaStatus()
  const [enrolling, setEnrolling] = useState(false)
  const [dismissedAt, setDismissedAt] = useState(0)
  const queryClient = useQueryClient()

  const open = shouldPromptForPrivilegedMfa({
    refusals: privilegedMfaRefusals,
    dismissedAt,
    factorsLoading: isLoading,
    enrolling,
  })

  const resolved = async () => {
    // Re-reads the assurance level, which clears the refusal count and closes
    // this for good; the screens that were refused are holding failed queries
    // the session can now serve, so let them ask again.
    await handleChanged()
    queryClient.invalidateQueries()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => setDismissedAt(privilegedMfaRefusals)}
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

          {enabled ? (
            <MfaChallengeStep
              showHeader={false}
              onVerified={resolved}
              onUseAnotherAccount={signOut}
              switchLabel="Sign out instead"
            />
          ) : (
            <>
              <p className="leading-relaxed text-ink-muted">
                Set up an authenticator app to finish. It takes about a minute,
                and this session unlocks straight away — you will not lose your
                place.
              </p>
              <div className="space-y-2">
                <Button className="w-full" onClick={() => setEnrolling(true)}>
                  Set up authenticator
                </Button>
                {/* The honest way past this for someone without their phone.
                    Dismissing only restores the silent version of the same
                    dead end, so it is offered but never the only exit. */}
                <Button variant="ghost" className="w-full" onClick={signOut}>
                  Sign out instead
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <MfaEnrollDialog
        open={enrolling}
        onClose={() => setEnrolling(false)}
        onChanged={resolved}
      />
    </>
  )
}
