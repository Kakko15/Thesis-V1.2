/**
 * Role-feature resolution for the client-side navigation guards.
 *
 * Kept pure and separate from AuthContext so the fallback contract below can be
 * asserted directly in unit tests.
 */

// Mirrors DEFAULT_FEATURES in rag-thesis-backend/routers/settings.py, which is
// what the server itself falls back to when the role_features row is absent.
export const DEFAULT_ROLE_FEATURES = Object.freeze({
  student: Object.freeze({ chat: true, archive: true, novelty: false, upload: false }),
  faculty: Object.freeze({ chat: true, archive: true, novelty: true, upload: false }),
})

/**
 * Whether `role` may use `feature`.
 *
 * `features` is the server-owned policy. A null policy means the fetch has not
 * succeeded, and the documented server defaults apply: denying instead would
 * lock a student out of chat over one transient error, and the server enforces
 * the novelty and upload gates independently of this value. An empty object is
 * a real policy that grants nothing, not a missing one.
 */
export function canUseFeature(role, features, feature) {
  if (role === 'admin' || role === 'superadmin') return true
  const policy = features ?? DEFAULT_ROLE_FEATURES
  return Boolean(policy?.[role]?.[feature])
}
