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
 * Roles the client never gates by feature policy. The server-owned policy only
 * covers student and faculty, so waiting for it before rendering a privileged
 * session's route bought nothing but a longer loading skeleton.
 */
export function bypassesFeaturePolicy(role) {
  return role === 'admin' || role === 'superadmin'
}

/**
 * How long a hard refresh waits for the feature policy before falling back to
 * DEFAULT_ROLE_FEATURES (see canUseFeature). The fetch keeps running and its
 * result replaces the defaults when it lands; the server enforces the novelty
 * and upload gates independently, so the fallback can never grant more than
 * the server allows.
 */
export const FEATURE_POLICY_WAIT_MS = 4000

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
  if (bypassesFeaturePolicy(role)) return true
  const policy = features ?? DEFAULT_ROLE_FEATURES
  return Boolean(policy?.[role]?.[feature])
}

/**
 * Resolve when `promise` settles or after `ms`, whichever is first. Never
 * rejects: the caller only needs to know whether the work finished in time.
 *
 * @returns {Promise<boolean>} true when `promise` settled within the window.
 */
export function settleWithin(promise, ms, setTimer = setTimeout, clearTimer = clearTimeout) {
  return new Promise((resolve) => {
    const timer = setTimer(() => resolve(false), ms)
    Promise.resolve(promise).then(
      () => { clearTimer(timer); resolve(true) },
      () => { clearTimer(timer); resolve(true) },
    )
  })
}
