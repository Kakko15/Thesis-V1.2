import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTH_UNAVAILABLE_DETAIL, apiErrorMessage, apiErrorStatus, isAuthServiceUnavailable, isRetryableFailure,
} from './apiErrors.js'

const failure = (status, data) => ({ response: { status, data } })

test('a FastAPI HTTPException detail reaches the reader verbatim', () => {
  // The refusal that left the Novelty page showing an unexplained empty panel:
  // the reason was on the wire the whole time and the UI dropped it.
  const mfa = failure(403, { detail: 'Multi-factor authentication is required for privileged access.' })
  assert.equal(
    apiErrorMessage(mfa, 'Scan history is unavailable.'),
    'Multi-factor authentication is required for privileged access.',
  )
})

test('a request-validation detail is flattened to field: message', () => {
  const invalid = failure(422, { detail: [{ loc: ['body', 'question'], msg: 'field required' }] })
  assert.equal(apiErrorMessage(invalid), 'body.question: field required')
})

test('a detail-less body falls back to message, then to the caller fallback', () => {
  assert.equal(apiErrorMessage(failure(500, { message: 'Upstream down' })), 'Upstream down')
  assert.equal(apiErrorMessage(failure(500, {}), 'Fallback text'), 'Fallback text')
  assert.equal(apiErrorMessage(failure(500, { detail: '   ' }), 'Fallback text'), 'Fallback text')
  assert.equal(apiErrorMessage(null, 'Fallback text'), 'Fallback text')
})

test('a request that never got a reply reports its own transport error', () => {
  assert.equal(apiErrorMessage({ message: 'Network Error' }), 'Network Error')
})

test('status is the reply status, and 0 when no reply arrived', () => {
  assert.equal(apiErrorStatus(failure(403, {})), 403)
  assert.equal(apiErrorStatus({ message: 'Network Error' }), 0)
  assert.equal(apiErrorStatus(undefined), 0)
})

test('Retry is offered only where repeating the request could change the answer', () => {
  // Settled decisions about this request: the button would re-run a refusal.
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    assert.equal(isRetryableFailure(failure(status, {})), false, `${status} must not offer Retry`)
  }
  // Server-side or transport-side, and genuinely capable of clearing.
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isRetryableFailure(failure(status, {})), true, `${status} must offer Retry`)
  }
  assert.equal(isRetryableFailure({ message: 'Network Error' }), true)
})

test('a validation error with no usable location is attributed to "Field"', () => {
  const invalid = failure(422, {
    detail: [
      { msg: 'value is not a valid email' },
      { loc: [], msg: 'request body is empty' },
      { loc: ['query', 'page'], msg: 'must be positive' },
    ],
  })
  assert.equal(
    apiErrorMessage(invalid),
    'Field: value is not a valid email, Field: request body is empty, query.page: must be positive',
  )
})

test('a brief authentication-service outage is recognised by its exact refusal', () => {
  assert.equal(isAuthServiceUnavailable(failure(503, { detail: AUTH_UNAVAILABLE_DETAIL })), true)
  // Any other 503 (capacity, readiness, archive outage) is not this case.
  assert.equal(isAuthServiceUnavailable(failure(503, { detail: 'The thesis archive is temporarily unavailable.' })), false)
  // A real token rejection stays a 401 and must never be retried as an outage.
  assert.equal(isAuthServiceUnavailable(failure(401, { detail: AUTH_UNAVAILABLE_DETAIL })), false)
  assert.equal(isAuthServiceUnavailable({}), false)
  assert.equal(isAuthServiceUnavailable(null), false)
})
