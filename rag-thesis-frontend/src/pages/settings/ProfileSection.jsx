import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Building2, Camera, CalendarDays, Check, Mail, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { apiErrorMessage, updateMyProfile } from '../../api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { RoleBadge } from '../../components/ui/Badge'
import { staggerItem } from '../../components/ui/Motion'
import { SectionCard, SettingRow, SettingRows } from './SectionCard'
import { extractOwnedAvatarPath, formatDate } from '../../lib/utils'

const AVATAR_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

function AvatarEditor({ user, profile, avatarUrl, refreshProfile }) {
  const fileInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!AVATAR_TYPES.has(file.type)) {
      toast.error('Unsupported avatar', { description: 'Use a JPG, PNG, or WebP image.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Avatar too large', { description: 'Maximum avatar size is 2 MB.' })
      return
    }

    setBusy(true)
    let uploadedPath = null
    let profileUpdated = false
    try {
      const fileExt = AVATAR_TYPES.get(file.type)
      const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`
      uploadedPath = filePath

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true })
      if (uploadError) throw uploadError

      // Store only the owned bucket path, never a caller-controlled URL.
      await updateMyProfile({ avatar_url: filePath })
      profileUpdated = true

      const previousPath = extractOwnedAvatarPath(profile?.avatar_url, user.id)
      if (previousPath && previousPath !== filePath) {
        const { error: cleanupError } = await supabase.storage.from('avatars').remove([previousPath])
        if (cleanupError) toast.warning('Avatar updated; old image cleanup is pending')
      }

      await refreshProfile()
      toast.success('Avatar updated successfully')
    } catch (err) {
      if (uploadedPath && !profileUpdated) {
        await supabase.storage.from('avatars').remove([uploadedPath]).catch(() => {})
      }
      toast.error('Failed to upload avatar', { description: err.message || apiErrorMessage(err) })
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = async () => {
    setRemoving(true)
    try {
      const ownedPath = extractOwnedAvatarPath(profile?.avatar_url, user.id)
      await updateMyProfile({ avatar_url: null })
      if (ownedPath) {
        const { error: cleanupError } = await supabase.storage.from('avatars').remove([ownedPath])
        if (cleanupError) toast.warning('Avatar removed; image cleanup is pending')
      }
      await refreshProfile()
      toast.success('Avatar removed')
    } catch (err) {
      toast.error('Failed to remove avatar', { description: apiErrorMessage(err) })
    } finally {
      setRemoving(false)
    }
  }

  const initial = (profile?.full_name || user?.email || '?').slice(0, 1).toUpperCase()

  /* Google-account style: the photo leads the page, centred, with the name and
     email under it, because it is the one thing on this page other people
     see. The camera button stays the upload path, labelled for AT. */
  return (
    <motion.div variants={staggerItem} className="flex flex-col items-center py-2 text-center">
      <div className="relative">
        <div className="size-24 overflow-hidden rounded-full bg-[var(--primary-container)] ring-4 ring-[var(--surface-0)] dark:ring-[var(--surface-1)] sm:size-28">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Your avatar" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-display text-4xl font-bold text-[var(--primary-container-foreground)]">
              {initial}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label="Upload a new avatar"
          className="absolute bottom-0 right-0 flex size-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-0)] text-ink shadow-sm transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50 dark:bg-[var(--surface-2)]"
        >
          <Camera size={16} />
        </button>
        <input type="file" ref={fileInputRef} onChange={handleUpload} accept="image/*" className="hidden" />
      </div>
      <p className="mt-4 font-display text-xl font-semibold">{profile?.full_name || 'Your profile'}</p>
      <p className="mt-0.5 text-sm text-ink-muted">{user?.email}</p>
      <p className="mt-2 text-xs text-ink-muted">JPG, PNG, or WebP, up to 2 MB.</p>
      {avatarUrl && (
        <Button variant="ghost" size="sm" className="mt-1 text-flame-600 hover:bg-flame-500/10 dark:text-flame-200" loading={removing} onClick={handleRemove}>
          <Trash2 size={13} /> Remove photo
        </Button>
      )}
    </motion.div>
  )
}

export function ProfileSection() {
  const { user, profile, avatarUrl, role, department, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [saving, setSaving] = useState(false)

  const dirty = fullName.trim() !== (profile?.full_name || '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateMyProfile({ full_name: fullName.trim() })
      await refreshProfile()
      toast.success('Profile updated successfully')
    } catch (err) {
      toast.error('Failed to update profile', { description: apiErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <AvatarEditor user={user} profile={profile} avatarUrl={avatarUrl} refreshProfile={refreshProfile} />

      <SectionCard title="Basic info" description="Your name as it appears on chats, uploads, and the admin console.">
        {/* The actions appear only once the name is edited, as in Google's
            account pages. A permanently disabled "Saved" button beside an
            untouched field read as a control that was broken, and on a phone
            it stretched into a full-width bar. */}
        <form
          className="space-y-3"
          onSubmit={(event) => { event.preventDefault(); if (dirty && fullName.trim()) handleSave() }}
        >
          <Input
            id="settings-full-name"
            label="Full name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="e.g. Juan Dela Cruz"
          />
          {dirty && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setFullName(profile?.full_name || '')} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving} disabled={!fullName.trim()}>
                <Check size={14} /> Save
              </Button>
            </div>
          )}
        </form>
      </SectionCard>

      <SectionCard
        title="Account"
        description="Assigned by an administrator, so they cannot be changed here."
        flush
      >
        <SettingRows>
          <SettingRow icon={Mail} label="Email">
            <span className="break-all">{user?.email}</span>
          </SettingRow>
          <SettingRow icon={ShieldCheck} label="Role">
            <RoleBadge role={role} />
          </SettingRow>
          <SettingRow icon={Building2} label="Department">
            {department || <span className="text-ink-muted">Not assigned</span>}
          </SettingRow>
          {user?.created_at && (
            <SettingRow icon={CalendarDays} label="Member since">
              {formatDate(user.created_at)}
            </SettingRow>
          )}
        </SettingRows>
      </SectionCard>
    </div>
  )
}
