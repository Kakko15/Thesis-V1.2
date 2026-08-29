import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../../supabaseClient'
import { Button } from '../../components/ui/Button'
import { StepHeader } from './StepHeader'
import { FloatingField, formStagger, PasswordEye, PasswordGuide, Rise, Shine } from './AuthFx'
import { friendlyAuthError, isStrongPassword } from './authUtils'

/** Final step of the recovery flow — the user arrived via the emailed link. */
export function ResetPasswordStep({ onDone }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)

  // Blur validation: leaving the field with a weak (or empty) password flags
  // it; once flagged, typing revalidates live so the error clears as it passes.
  const passwordError = (value) => {
    if (!value) return 'Please enter a password'
    return isStrongPassword(value) ? '' : 'Use 8+ characters with uppercase, number, and symbol'
  }
  const handleBlur = () => {
    setTouched(true)
    setError(passwordError(password))
  }
  const handleChange = (e) => {
    const { value } = e.target
    setPassword(value)
    if (touched) setError(passwordError(value))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const message = passwordError(password)
    if (message) {
      setTouched(true)
      setError(message)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      toast.success('Password updated', { description: 'You are signed in with your new password.' })
      onDone?.()
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <StepHeader
        icon={ShieldCheck}
        title="Choose a new password"
        subtitle="You're securely signed in through the reset link — set a fresh password to finish."
      />

      <motion.form
        variants={formStagger}
        initial="hidden"
        animate="show"
        onSubmit={handleSubmit}
        className="space-y-5"
        noValidate
      >
        <Rise>
          <FloatingField
            label="New password"
            required
            type={showPassword ? 'text' : 'password'}
            name="new-password"
            value={password}
            error={error}
            onChange={handleChange}
            onBlur={handleBlur}
            autoComplete="new-password"
            autoFocus
            endAdornment={<PasswordEye show={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
          />

          <PasswordGuide password={password} />
        </Rise>

        <Rise>
          <Button
            type="submit"
            size="lg"
            loading={loading}
            className="group relative w-full overflow-hidden"
          >
            <Shine />
            Update password & continue
          </Button>
        </Rise>
      </motion.form>
    </div>
  )
}
