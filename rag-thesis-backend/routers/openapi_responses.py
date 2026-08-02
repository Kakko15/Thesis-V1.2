"""Reusable OpenAPI error-response documentation for the API routers.

FastAPI merges a route's ``responses`` mapping into the generated OpenAPI
schema. It is documentation only: it never changes runtime behaviour, the
status codes actually emitted, authorization, or response bodies.

Descriptions live here once so that documenting the same status code across
many routers does not duplicate literals.
"""

_DESCRIPTIONS: dict[int, str] = {
    400: 'The request payload or parameters were rejected.',
    401: 'Authentication is required, or the supplied token is not valid.',
    403: 'The authenticated account is not permitted to perform this action.',
    404: 'The resource does not exist, or is not visible to this account.',
    409: 'The request conflicts with the current state of the resource.',
    413: 'The uploaded file exceeds the configured size limit.',
    415: 'The uploaded file type is not accepted.',
    422: 'The request was well formed but failed validation.',
    500: 'The server could not complete the request.',
    502: 'An upstream AI service was unavailable or returned an error.',
    503: 'A required backing service is temporarily unavailable.',
}


def errors(*codes: int) -> dict[int, dict[str, str]]:
    """Return an OpenAPI ``responses`` mapping for the given error codes."""
    return {code: {'description': _DESCRIPTIONS[code]} for code in sorted(set(codes))}
