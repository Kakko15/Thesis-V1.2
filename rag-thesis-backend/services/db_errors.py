"""Postgres error classification shared by the catalog and department writers.

The Supabase SDK raises opaque exceptions whose SQLSTATE may sit on `code`, on
`pgcode`, or only inside the message text, so a caller that wants to turn a
constraint violation into a useful status has to probe all three. Keeping the
probe in one place stops the two superadmin write paths from disagreeing about
what a duplicate key looks like.
"""

UNIQUE_VIOLATION_SQLSTATE = '23505'


def is_unique_violation(error: Exception) -> bool:
    """True when `error` is a Postgres unique-constraint violation."""
    for attribute in ('code', 'pgcode'):
        if str(getattr(error, attribute, '') or '') == UNIQUE_VIOLATION_SQLSTATE:
            return True
    details = getattr(error, 'details', None) or getattr(error, 'message', None) or str(error)
    text = str(details).lower()
    return UNIQUE_VIOLATION_SQLSTATE in text or 'duplicate key value' in text
