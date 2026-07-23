"""Service-role client helpers for the durable thesis-ingestion queue."""

import logging
import re
from datetime import datetime, timedelta, timezone

from services.cleanup import record_storage_cleanup
from services.ingestion import LeaseLostError, PermanentIngestionError
from services.network_retry import is_transient_network_error

logger = logging.getLogger(__name__)

_RETRY_DELAYS = (30, 120, 600)


def _rpc_bool(client, name: str, payload: dict) -> bool:
    data = client.rpc(name, payload).execute().data
    if isinstance(data, list):
        return bool(data and data[0])
    return bool(data)


def claim_job(client, worker_id: str, lease_seconds: int) -> dict | None:
    data = client.rpc('claim_upload_job', {
        'p_worker_id': worker_id,
        'p_lease_seconds': lease_seconds,
    }).execute().data
    if isinstance(data, list):
        return data[0] if data else None
    return data or None


def heartbeat_job(client, job_id: str, worker_id: str, lease_seconds: int,
                  *, stage: str | None = None, progress: int | None = None,
                  message: str | None = None) -> bool:
    return _rpc_bool(client, 'heartbeat_upload_job', {
        'p_job_id': job_id,
        'p_worker_id': worker_id,
        'p_lease_seconds': lease_seconds,
        'p_stage': stage,
        'p_progress': progress,
        'p_message': message,
    })


def heartbeat_job_control(client, job_id: str, worker_id: str, lease_seconds: int,
                          *, stage: str | None = None, progress: int | None = None,
                          message: str | None = None) -> dict:
    payload = {
        'p_job_id': job_id,
        'p_worker_id': worker_id,
        'p_lease_seconds': lease_seconds,
        'p_stage': stage,
        'p_progress': progress,
        'p_message': message,
    }
    try:
        data = client.rpc('heartbeat_upload_job_control', payload).execute().data
        if isinstance(data, list):
            data = data[0] if data else {}
        return data or {'lease_valid': False, 'cancel_requested': False}
    except Exception as error:
        text = str(error).lower()
        missing = 'pgrst202' in text or '42883' in text or 'could not find the function' in text
        if not missing:
            raise
        return {
            'lease_valid': heartbeat_job(
                client, job_id, worker_id, lease_seconds,
                stage=stage, progress=progress, message=message,
            ),
            'cancel_requested': False,
        }


def finalize_cancellation(client, job_id: str, worker_id: str) -> bool:
    return _rpc_bool(client, 'finalize_upload_cancellation', {
        'p_job_id': job_id,
        'p_worker_id': worker_id,
    })


def is_retryable_ingestion_error(error: BaseException) -> bool:
    if isinstance(error, (PermanentIngestionError, LeaseLostError)):
        return False
    if is_transient_network_error(error):
        return True
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        status = getattr(current, 'status_code', None) or getattr(current, 'code', None)
        try:
            numeric_status = int(status)
        except (TypeError, ValueError):
            numeric_status = 0
        if numeric_status in {408, 429} or 500 <= numeric_status <= 599:
            return True
        current = current.__cause__ or current.__context__
    return False


def _retry_after_seconds(error: BaseException) -> int | None:
    headers = getattr(error, 'headers', None) or getattr(
        getattr(error, 'response', None), 'headers', None
    )
    value = headers.get('retry-after') if headers else None
    if value is not None:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            pass
    match = re.search(r'retry[- ]after[^0-9]*(\d+)', str(error), re.IGNORECASE)
    return int(match.group(1)) if match else None


def retry_at(error: BaseException, attempt_count: int) -> datetime:
    index = max(0, min(attempt_count - 1, len(_RETRY_DELAYS) - 1))
    seconds = _RETRY_DELAYS[index]
    provider_delay = _retry_after_seconds(error)
    if provider_delay is not None:
        seconds = max(seconds, min(provider_delay, 15 * 60))
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


def schedule_retry(client, job: dict, worker_id: str, error: BaseException) -> bool:
    return _rpc_bool(client, 'schedule_upload_retry', {
        'p_job_id': str(job['id']),
        'p_worker_id': worker_id,
        'p_retry_at': retry_at(error, int(job.get('attempt_count') or 1)).isoformat(),
        'p_failure_category': type(error).__name__,
    })


def fail_job(client, job_id: str, worker_id: str, error: BaseException) -> bool:
    public_error = (
        'The manuscript could not be processed safely.'
        if isinstance(error, PermanentIngestionError)
        else 'The thesis could not be safely indexed after the allowed retries.'
    )
    return _rpc_bool(client, 'fail_upload_job', {
        'p_job_id': job_id,
        'p_worker_id': worker_id,
        'p_failure_category': type(error).__name__,
        'p_public_error': public_error,
    })


def process_one_cleanup(client, worker_id: str) -> bool:
    data = client.rpc('claim_upload_cleanup', {'p_worker_id': worker_id}).execute().data
    job = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None
    if not job:
        return False
    job_id = str(job['id'])
    source_path = str(job.get('source_path') or '')
    delegated = False
    try:
        if source_path:
            client.storage.from_('pdfs').remove([source_path])
    except Exception as cleanup_error:
        delegated = record_storage_cleanup(
            client,
            operation='rollback_upload',
            resource_path=source_path,
            job_id=job_id,
            error=cleanup_error,
        )
        if not delegated:
            logger.error('Upload source cleanup could not be persisted for job %s', job_id)
            return False
    _rpc_bool(client, 'finish_upload_cleanup', {
        'p_job_id': job_id,
        'p_worker_id': worker_id,
        'p_delegated': delegated,
    })
    return True


def expire_terminal_jobs(client) -> int:
    data = client.rpc('expire_upload_jobs', {}).execute().data
    return int(data or 0)
