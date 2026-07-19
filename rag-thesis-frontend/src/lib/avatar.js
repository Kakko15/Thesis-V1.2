import { supabase } from '../supabaseClient'

export function avatarPublicUrl(path) {
  if (!path || path.includes('://') || !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/.test(path)) {
    return null
  }
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}
