"""Persistent records for storage cleanup that could not complete immediately."""

import logging

logger = logging.getLogger(__name__)


def record_storage_cleanup(
    client,
    *,
    resource_path: str,
    operation: str,
    error: Exception,
    paper_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    """Persist safe cleanup metadata without storing exception text or file contents."""
    try:
        client.table('storage_cleanup_queue').insert({
            'operation': operation,
            'resource_path': resource_path,
            'paper_id': paper_id,
            'job_id': job_id,
            'error_category': type(error).__name__,
            'status': 'pending',
        }).execute()
        return True
    except Exception as queue_error:
        logger.critical(
            'Could not persist cleanup task for %s (%s)',
            resource_path,
            type(queue_error).__name__,
        )
        return False
