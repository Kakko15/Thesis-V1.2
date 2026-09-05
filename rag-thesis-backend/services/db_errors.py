"""Postgres error classification shared by the routers.

The Supabase SDK raises opaque exceptions whose SQLSTATE may sit on `code`, on
`pgcode`, or only inside the message text, so a caller that wants to turn a
driver error into a useful status has to probe all three. Keeping the probe in
one place stops the call sites from disagreeing about what a duplicate key, a
missing column, or a malformed identifier looks like.
"""

from contextlib import contextmanager

from fastapi import HTTPException

UNIQUE_VIOLATION_SQLSTATE = '23505'
UNDEFINED_COLUMN_SQLSTATE = '42703'
INVALID_TEXT_REPRESENTATION_SQLSTATE = '22P02'


def _error_text(error: Exception) -> str:
    """The most specific rendering of `error` the SDK exposes, lowercased."""
    details = getattr(error, 'details', None) or getattr(error, 'message', None) or str(error)
    return str(details).lower()


def _sqlstate_matches(error: Exception, sqlstate: str) -> bool:
    """Whether `error` carries `sqlstate` on any shape the SDK might use."""
    for attribute in ('code', 'pgcode'):
        if str(getattr(error, attribute, '') or '') == sqlstate:
            return True
    return sqlstate.lower() in _error_text(error)


def is_unique_violation(error: Exception) -> bool:
    """True when `error` is a Postgres unique-constraint violation."""
    return (
        _sqlstate_matches(error, UNIQUE_VIOLATION_SQLSTATE)
        or 'duplicate key value' in _error_text(error)
    )


def is_invalid_identifier(error: Exception) -> bool:
    """True when Postgres rejected a value's syntax (SQLSTATE 22P02).

    A path parameter that is not a UUID reaches PostgREST unchanged and comes
    back as this driver error, which the SDK raises as an opaque exception. A
    route that does not recognise it answers an unhandled 500 for what is only
    a mistyped identifier.
    """
    return (
        _sqlstate_matches(error, INVALID_TEXT_REPRESENTATION_SQLSTATE)
        or 'invalid input syntax for type uuid' in _error_text(error)
    )


def is_missing_column(error: Exception) -> bool:
    """True when Postgres rejected a column that does not exist (SQLSTATE 42703).

    The additive migrations leave an older project without newer columns, so a
    few reads retry against a reduced column list. Only this error justifies
    that retry: catching every exception turned a transient read failure into a
    second identical attempt and then an unhandled 500.
    """
    if _sqlstate_matches(error, UNDEFINED_COLUMN_SQLSTATE):
        return True
    text = _error_text(error)
    return 'column ' in text and ' does not exist' in text


@contextmanager
def identifier_not_found(detail: str, status_code: int = 404):
    """Answer a malformed identifier the way the route answers an absent one.

    Postgres cannot tell "no such row" from "that is not a UUID": the first
    returns an empty result and the second raises. Both mean the addressed
    record is not there, so the malformed case is given the status the route
    already documents for the empty one instead of surfacing an opaque driver
    error to the caller as a 500. `status_code` covers the routes that answer
    an unusable reference with 422 rather than 404.
    """
    try:
        yield
    except HTTPException:
        raise
    except Exception as error:
        if not is_invalid_identifier(error):
            raise
        raise HTTPException(status_code=status_code, detail=detail) from error
