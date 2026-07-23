import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { MailCheck, ExternalLink } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { StepHeader } from './StepHeader'
import { formStagger, Rise, Shine, UnderlineLink } from './AuthFx'
import { authOptions, friendlyAuthError, maskEmail, retryAfterSeconds, useResendTimer } from './authUtils'
import { TurnstileWidget } from '../../components/security/TurnstileWidget'
import { turnstileEnabled } from '../../components/security/turnstileConfig'

const getEmailLink = (email) => {
  const e = email.toLowerCase()
  if (e.endsWith('@gmail.com') || e.endsWith('@isu.edu.ph')) return 'https://mail.google.com'
  if (e.endsWith('@yahoo.com')) return 'https://mail.yahoo.com'
  if (e.endsWith('@outlook.com') || e.endsWith('@hotmail.com')) return 'https://outlook.live.com'
  return 'mailto:'
}

/** Passwordless sign-in: tells the user to click the magic link in their email. */
export function OtpSignInStep({ email, onBack }) {
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useResendTimer(60)
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaReset, setCaptchaReset] = useState(0)

  const resend = async () => {
    setResending(true)
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: authOptions({ shouldCreateUser: false }, captchaToken),
      })
      if (err) throw err
      toast.success('New link sent', { description: `Check ${maskEmail(email)}` })
      setCooldown(60)
    } catch (err) {
      toast.error('Failed to resend', { description: friendlyAuthError(err) })
      const wait = retryAfterSeconds(err)
      if (wait) setCooldown(wait)
    } finally {
      setResending(false)
      setCaptchaToken(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  return (
    <div>
      <StepHeader
        icon={MailCheck}
        title="Check your inbox"
        subtitle={
          <>
            We sent a secure sign-in link to <span className="font-semibold">{maskEmail(email)}</span>.
            Click the link in the email to sign in instantly.
          </>
        }
        onBack={onBack}
        backLabel="Sign in another way"
      />

      <motion.div variants={formStagger} initial="hidden" animate="show">
        <Rise>
          <Button
            size="lg"
            onClick={() => window.open(getEmailLink(email), '_blank')}
            className="group relative mt-6 w-full overflow-hidden"
          >
            <Shine />
            Go to email
            <ExternalLink size={16} className="ml-2 opacity-70" />
          </Button>
        </Rise>

        <Rise className="mt-5 text-center text-xs opacity-60">
          <TurnstileWidget action="otp_resend" onToken={setCaptchaToken} resetKey={captchaReset} />
          Didn't get it?{' '}
          {cooldown > 0 ? (
            <span className="font-semibold tabular-nums">Resend in {cooldown}s</span>
          ) : (
            <UnderlineLink
              onClick={resend}
              disabled={resending || (turnstileEnabled && !captchaToken)}
              aria-disabled={turnstileEnabled && !captchaToken}
              className="text-forest-600 disabled:opacity-50 dark:text-gold-300"
            >
              {resending ? 'Sending…' : 'Resend link'}
            </UnderlineLink>
          )}
        </Rise>
      </motion.div>
    </div>
  )
}
