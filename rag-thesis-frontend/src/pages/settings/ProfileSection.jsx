import { useRef, useState } from 'react'
import { Camera, CalendarDays, Check, Mail, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { apiErrorMessage, updateMyProfile } from '../../api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge, RoleBadge } from '../../components/ui/Badge'
import { SectionCard } from './SectionCard'
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

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="group relative">
        <div className="h-24 w-24 overflow-hidden rounded-[1.75rem] border-2 border-transparent bg-forest-900/10 shadow-xl shadow-forest-900/10 transition-all duration-300 group-hover:rotate-2 group-hover:scale-[1.03] group-hover:border-forest-500/50 dark:bg-white/10">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Your avatar" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-forest-600 to-forest-800 font-display text-3xl font-extrabold text-gold-300">
              {(profile?.full_name || user?.email || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label="Upload a new avatar"
          className="absolute -bottom-1.5 -right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-forest-600 text-white shadow-lg transition-all duration-200 hover:scale-110 hover:bg-forest-500 disabled:opacity-50"
        >
          <Camera size={15} />
        </button>
        <input type="file" ref={fileInputRef} onChange={handleUpload} accept="image/*" className="hidden" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">Profile picture</h3>
        <p className="mt-0.5 text-xs text-ink-muted">JPG, PNG, or WebP · max 2 MB. Shown across the library.</p>
        {avatarUrl && (
          <Button variant="ghost" size="sm" className="mt-2 text-flame-500 hover:bg-flame-500/10" loading={removing} onClick={handleRemove}>
            <Trash2 size={13} /> Remove photo
          </Button>
        )}
      </div>
    </div>
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
      <SectionCard icon={UserRound} title="Identity" description="How you appear across the thesis library.">
        <AvatarEditor user={user} profile={profile} avatarUrl={avatarUrl} refreshProfile={refreshProfile} />

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="settings-full-name" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Full name
            </label>
            <div className="flex gap-2">
              <Input
                id="settings-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                className="flex-1"
              />
              <Button onClick={handleSave} loading={saving} disabled={!dirty || !fullName.trim()}>
                {dirty ? <><Check size={15} /> Save</> : 'Saved'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-forest-900/10 pt-4 dark:border-white/10">
            <RoleBadge role={role} />
            {department && <Badge tone="neutral">{department}</Badge>}
            <Badge tone="neutral"><Mail size={11} /> {user?.email}</Badge>
            {user?.created_at && (
              <Badge tone="gold"><CalendarDays size={11} /> Member since {formatDate(user.created_at)}</Badge>
            )}
          </div>
          <p className="text-xs text-ink-faint">
            Your role and department are assigned by an administrator and cannot be changed here.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}
