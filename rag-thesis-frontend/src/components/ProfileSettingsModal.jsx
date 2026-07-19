import { useState, useRef, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { updateMyProfile, apiErrorMessage } from '../api'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { User, Camera, Shield, Lock, Mail, Save, X, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cn, extractOwnedAvatarPath } from '../lib/utils'
import { OtpInput } from './ui/OtpInput'
import { isStrongPassword } from '../pages/auth/authUtils'

export function ProfileSettingsModal({ open, onClose }) {
  const { user, profile, avatarUrl, refreshProfile, reloadSession } = useAuth()
  
  const [tab, setTab] = useState('profile') // 'profile' | 'security'
  
  // Form States
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  
  // OTP States
  const [verifyingEmail, setVerifyingEmail] = useState(false)
  const [emailCode, setEmailCode] = useState('')
  const [shakeEmailNonce, setShakeEmailNonce] = useState(0)

  const [verifyingPassword, setVerifyingPassword] = useState(false)
  const [passwordCode, setPasswordCode] = useState('')
  const [shakePasswordNonce, setShakePasswordNonce] = useState(0)

  const fileInputRef = useRef(null)
  const wasOpen = useRef(false)

  // Sync profile data gracefully
  useEffect(() => {
    if (open) {
      setFullName(prev => (!prev && profile?.full_name) ? profile.full_name : prev)
      setEmail(prev => (!prev && user?.email) ? user.email : prev)
    }
  }, [open, profile, user])

  // Reset UI fields only when the modal is freshly opened
  useEffect(() => {
    if (open && !wasOpen.current) {
      setPassword('')
      setTab('profile')
      setVerifyingEmail(false)
      setEmailCode('')
      setVerifyingPassword(false)
      setPasswordCode('')
      setFullName(profile?.full_name || '')
      setEmail(user?.email || '')
    }
    wasOpen.current = open
  }, [open, profile, user])

  const handleSaveProfile = async () => {
    setLoading(true)
    try {
      await updateMyProfile({ full_name: fullName })
      await refreshProfile()
      toast.success('Profile updated successfully')
    } catch (err) {
      toast.error('Failed to update profile', { description: apiErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateEmail = async () => {
    if (!email || email === user?.email) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ email })
      if (error) throw error
      setVerifyingEmail(true)
      toast.success('6-digit code sent to your new email.')
    } catch (err) {
      toast.error('Failed to update email: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyEmail = async () => {
    if (emailCode.length !== 6) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: emailCode, type: 'email_change' })
      if (error) throw error
      toast.success('Email updated successfully')
      setVerifyingEmail(false)
      setEmailCode('')
      await reloadSession()
      await refreshProfile()
    } catch (err) {
      toast.error('Verification failed', { description: apiErrorMessage(err) })
      setShakeEmailNonce(n => n + 1)
      setEmailCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleRequestPasswordChange = async () => {
    if (!isStrongPassword(password)) {
      toast.error('Use 8+ characters with uppercase, number, and symbol')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: window.location.origin,
      })
      if (error) throw error
      setVerifyingPassword(true)
      toast.success('6-digit code sent to your email.')
    } catch (err) {
      toast.error('Failed to request password change: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyPassword = async () => {
    if (passwordCode.length !== 6) return
    setLoading(true)
    try {
      // 1. Verify OTP
      const { error: otpError } = await supabase.auth.verifyOtp({ email: user.email, token: passwordCode, type: 'recovery' })
      if (otpError) throw otpError

      // 2. Update password
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      toast.success('Password updated successfully')
      setVerifyingPassword(false)
      setPasswordCode('')
      setPassword('')
    } catch (err) {
      toast.error('Verification failed', { description: apiErrorMessage(err) })
      setShakePasswordNonce(n => n + 1)
      setPasswordCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = new Map([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ])
    if (!allowedTypes.has(file.type)) {
      toast.error('Unsupported avatar', { description: 'Use a JPG, PNG, or WebP image.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Avatar too large', { description: 'Maximum avatar size is 2 MB.' })
      return
    }
    
    setUploadingAvatar(true)
    let uploadedPath = null
    let profileUpdated = false
    try {
      // 1. Upload to Storage
      const fileExt = allowedTypes.get(file.type)
      const fileName = `avatar-${Date.now()}.${fileExt}`
      const filePath = `${user.id}/${fileName}`
      uploadedPath = filePath

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      // 2. Store only the owned bucket path, never a caller-controlled URL.
      await updateMyProfile({ avatar_url: filePath })
      profileUpdated = true

      const previousPath = extractOwnedAvatarPath(profile?.avatar_url, user.id)
      if (previousPath && previousPath !== filePath) {
        const { error: cleanupError } = await supabase.storage
          .from('avatars')
          .remove([previousPath])
        if (cleanupError) {
          toast.warning('Avatar updated; old image cleanup is pending')
        }
      }
      
      // 3. Refresh UI
      await refreshProfile()
      toast.success('Avatar updated successfully')
      
    } catch (err) {
      if (uploadedPath && !profileUpdated) {
        await supabase.storage.from('avatars').remove([uploadedPath]).catch(() => {})
      }
      toast.error('Failed to upload avatar: ' + (err.message || apiErrorMessage(err)))
    } finally {
      setUploadingAvatar(false)
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="md">
      <div className="flex gap-4 border-b border-forest-900/10 pb-4 mb-6 dark:border-white/10">
        <button
          onClick={() => setTab('profile')}
          className={cn(
            "pb-2 font-medium text-sm transition-colors relative",
            tab === 'profile' ? "text-forest-600 dark:text-forest-400" : "opacity-60 hover:opacity-100"
          )}
        >
          Profile
          {tab === 'profile' && <div className="absolute -bottom-4 left-0 right-0 h-0.5 bg-forest-500 rounded-t-full" />}
        </button>
        <button
          onClick={() => setTab('security')}
          className={cn(
            "pb-2 font-medium text-sm transition-colors relative",
            tab === 'security' ? "text-forest-600 dark:text-forest-400" : "opacity-60 hover:opacity-100"
          )}
        >
          Security
          {tab === 'security' && <div className="absolute -bottom-4 left-0 right-0 h-0.5 bg-forest-500 rounded-t-full" />}
        </button>
      </div>

      <div className="space-y-6">
        {tab === 'profile' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            
            {/* Avatar Section */}
            <div className="flex items-center gap-6">
              <div className="relative group">
                <div className="h-20 w-20 rounded-full overflow-hidden bg-forest-900/10 dark:bg-white/10 flex items-center justify-center border-2 border-transparent group-hover:border-forest-500/50 transition-colors">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <User size={32} className="opacity-40" />
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-forest-600 text-white flex items-center justify-center shadow-lg hover:bg-forest-500 transition-colors disabled:opacity-50"
                >
                  <Camera size={14} />
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleAvatarUpload}
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold mb-1">Profile Picture</h3>
                <p className="text-xs opacity-60">Upload a new avatar. JPG or PNG. Max size 2MB.</p>
              </div>
            </div>

            {/* Profile Fields */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider opacity-60 mb-2">
                  Full Name
                </label>
                <Input 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Juan Dela Cruz"
                  className="w-full"
                />
              </div>

              <Button loading={loading} onClick={handleSaveProfile} className="w-full mt-2">
                <Save size={16} className="mr-2" /> Save Profile
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-xs font-semibold uppercase tracking-wider opacity-60 mb-2 flex items-center gap-2">
                  <Mail size={12} /> Email Address
                </label>
                
                {verifyingEmail ? (
                  <div className="space-y-4 rounded-xl border border-gold-400/20 bg-gold-400/5 p-4">
                    <div className="text-sm">Enter the 6-digit code sent to <span className="font-semibold">{email}</span></div>
                    <OtpInput
                      value={emailCode}
                      onChange={setEmailCode}
                      onComplete={handleVerifyEmail}
                      disabled={loading}
                      shakeNonce={shakeEmailNonce}
                      ariaLabel="Email verification code"
                    />
                    <div className="flex gap-2 justify-end mt-2">
                      <Button variant="ghost" size="sm" onClick={() => setVerifyingEmail(false)}>Cancel</Button>
                      <Button size="sm" loading={loading} disabled={emailCode.length !== 6} onClick={handleVerifyEmail}>Verify</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="flex-1"
                      />
                      <Button variant="secondary" loading={loading} onClick={handleUpdateEmail} disabled={email === user?.email || !email}>
                        Update
                      </Button>
                    </div>
                    <p className="text-[10px] opacity-60 mt-1.5 ml-1">You will need to verify your new email with a 6-digit code.</p>
                  </>
                )}
              </div>

              <div className="pt-2 border-t border-forest-900/10 dark:border-white/10">
                <label className="block text-xs font-semibold uppercase tracking-wider opacity-60 mb-2 flex items-center gap-2 mt-4">
                  <Lock size={12} /> Change Password
                </label>
                
                {verifyingPassword ? (
                  <div className="space-y-4 rounded-xl border border-gold-400/20 bg-gold-400/5 p-4">
                    <div className="text-sm">To change your password, enter the 6-digit code sent to your email.</div>
                    <OtpInput
                      value={passwordCode}
                      onChange={setPasswordCode}
                      onComplete={handleVerifyPassword}
                      disabled={loading}
                      shakeNonce={shakePasswordNonce}
                      ariaLabel="Password verification code"
                    />
                    <div className="flex gap-2 justify-end mt-2">
                      <Button variant="ghost" size="sm" onClick={() => setVerifyingPassword(false)}>Cancel</Button>
                      <Button size="sm" loading={loading} disabled={passwordCode.length !== 6} onClick={handleVerifyPassword}>Verify & Save</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input 
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="New password (min. 8 chars)"
                      className="flex-1"
                    />
                    <Button variant="secondary" loading={loading} onClick={handleRequestPasswordChange} disabled={!isStrongPassword(password)}>
                      Update
                    </Button>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </Modal>
  )
}
