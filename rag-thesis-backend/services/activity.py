"""Lightweight activity logging for institutional research analytics."""

import logging

from dependencies.auth import sb

logger = logging.getLogger(__name__)


def log_activity(user_id: str | None, action: str, detail: dict | None = None):
    """Record an event; analytics must never break the primary request."""
    try:
        sb.table('activity_log').insert({
            'user_id': user_id,
            'action': action,
            'detail': detail or {},
        }).execute()
    except Exception as e:
        logger.warning('Activity log insert failed (%s): %s', action, e)
