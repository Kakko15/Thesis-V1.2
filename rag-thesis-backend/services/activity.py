"""Lightweight activity logging for institutional research analytics."""

import logging

from dependencies.auth import sb

logger = logging.getLogger(__name__)


def log_activity(
    user_id: str | None,
    action: str,
    detail: dict | None = None,
    department: str | None = None,
):
    """Record an event; analytics must never break the primary request."""
    try:
        safe_detail = detail or {}
        event_department = department or safe_detail.get('department')
        if not event_department and user_id:
            profile = (
                sb.table('profiles')
                .select('department')
                .eq('id', user_id)
                .limit(1)
                .execute()
            )
            if profile.data:
                event_department = profile.data[0].get('department')
        sb.table('activity_log').insert({
            'user_id': user_id,
            'action': action,
            'department': event_department,
            'detail': safe_detail,
        }).execute()
    except Exception as error:  # Analytics must not break the primary request.
        logger.warning(
            'Activity log insert failed (%s, %s)',
            action,
            type(error).__name__,
        )
