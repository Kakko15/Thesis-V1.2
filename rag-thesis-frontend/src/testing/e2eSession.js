const E2E_AUTH_STORAGE_KEY = 'isu_e2e_auth_fixture'

export const isE2ETestMode = import.meta.env.MODE === 'e2e'

export function readE2EAuthFixture() {
  if (!isE2ETestMode || typeof window === 'undefined') return null
  try {
    const fixture = JSON.parse(window.localStorage.getItem(E2E_AUTH_STORAGE_KEY) || 'null')
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) return null
    if (fixture.user && (!fixture.user.id || !fixture.profile?.role)) return null
    return fixture
  } catch {
    return null
  }
}

export function clearE2EAuthFixture() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY)
}

export { E2E_AUTH_STORAGE_KEY }
