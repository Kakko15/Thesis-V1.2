import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HEALTH_QUERY_RETRY,
  HEALTH_QUERY_RETRY_DELAY_MS,
  HEALTH_STATES,
  deriveHealthStatus,
} from './healthStatus.js'

test('the initial in-flight check is neutral, never "Offline"', () => {
  const status = deriveHealthStatus({ data: undefined, isError: false, isPending: true })
  assert.equal(status.state, HEALTH_STATES.CHECKING)
  assert.equal(status.label, 'Checking…')
  assert.equal(status.ariaLabel, 'System checking')
})

test('settled states keep their existing labels and aria-labels', () => {
  assert.deepEqual(
    deriveHealthStatus({ data: { status: 'ok' } }),
    { state: 'online', label: 'Online', ariaLabel: 'System online' },
  )
  assert.deepEqual(
    deriveHealthStatus({ data: { status: 'degraded' } }),
    { state: 'degraded', label: 'Degraded', ariaLabel: 'System degraded' },
  )
  assert.deepEqual(
    deriveHealthStatus({ isError: true }),
    { state: 'offline', label: 'Offline', ariaLabel: 'System offline' },
  )
})

test('a failed refetch after a good result reports offline, as before', () => {
  assert.equal(deriveHealthStatus({ data: { status: 'ok' }, isError: true }).state, HEALTH_STATES.OFFLINE)
})

test('a response without a status is offline, not online', () => {
  assert.equal(deriveHealthStatus({ data: {} }).state, HEALTH_STATES.OFFLINE)
  assert.equal(deriveHealthStatus({}).state, HEALTH_STATES.OFFLINE)
})

test('cached data wins over a background refetch in flight', () => {
  assert.equal(deriveHealthStatus({ data: { status: 'ok' }, isPending: true }).state, HEALTH_STATES.ONLINE)
})

test('a cold-start failure is retried quickly instead of waiting a full poll', () => {
  assert.equal(HEALTH_QUERY_RETRY, 2)
  assert.equal(HEALTH_QUERY_RETRY_DELAY_MS, 1000)
})
