"""Privacy-safe worker registry, operational alerts, and security audit helpers."""

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from config import settings

logger = logging.getLogger(__name__)


def _timestamp(value) -> datetime:
    """Parse provider timestamps consistently; malformed values fail stale."""
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


def _rpc_bool(client, name: str, payload: dict) -> bool:
    data = client.rpc(name, payload).execute().data
    if isinstance(data, list):
        return bool(data and data[0])
    return bool(data)


def _missing_rpc(error: BaseException) -> bool:
    text = str(error).lower()
    return 'pgrst202' in text or '42883' in text or 'could not find the function' in text


def register_worker(client, worker_id: str, *, state: str, scanner: str,
                    current_job_id: str | None = None, version: str = '2.1.0') -> bool:
    try:
        return _rpc_bool(client, 'register_ingestion_worker', {
            'p_worker_id': worker_id,
            'p_state': state,
            'p_scanner_status': scanner,
            'p_version': version,
            'p_current_job_id': current_job_id,
        })
    except Exception as error:
        if _missing_rpc(error):
            return False
        raise


def stop_worker(client, worker_id: str) -> bool:
    try:
        return _rpc_bool(client, 'stop_ingestion_worker', {'p_worker_id': worker_id})
    except Exception as error:
        if _missing_rpc(error):
            return False
        raise


def record_security_event(client, event_type: str, *, severity: str = 'info',
                          actor_id: str | None = None, department: str | None = None,
                          details: dict | None = None) -> None:
    client.table('security_audit_events').insert({
        'actor_id': actor_id,
        'event_type': event_type[:120],
        'severity': severity,
        'department': department,
        'safe_details': details or {},
    }).execute()


def upsert_alert(client, dedupe_key: str, alert_type: str, severity: str,
                 details: dict | None = None) -> dict | None:
    """Persist one deduplicated alert without user or manuscript content."""
    try:
        rows = client.rpc('upsert_operational_alert', {
            'p_dedupe_key': dedupe_key,
            'p_alert_type': alert_type,
            'p_severity': severity,
            'p_safe_details': details or {},
        }).execute().data or []
        return rows[0] if isinstance(rows, list) and rows else rows or None
    except Exception as error:
        if not _missing_rpc(error):
            raise
        # Backward-compatible path used before the additive migration is deployed.
    existing = (
        client.table('operational_alerts').select('*')
        .eq('dedupe_key', dedupe_key).limit(1).execute().data or []
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        row = existing[0]
        was_resolved = row.get('status') == 'resolved'
        updated = (
            client.table('operational_alerts').update({
                'alert_type': alert_type,
                'severity': severity,
                # Acknowledgement remains visible while the condition is
                # active. A resolved alert reopens as a new occurrence.
                'status': 'open' if was_resolved else row.get('status', 'open'),
                'safe_details': details or {},
                'occurrence_count': int(row.get('occurrence_count') or 1) + int(was_resolved),
                'last_seen_at': now,
                'resolved_at': None,
                'acknowledged_at': None if was_resolved else row.get('acknowledged_at'),
                'acknowledged_by': None if was_resolved else row.get('acknowledged_by'),
                'updated_at': now,
            }).eq('id', row['id']).execute().data or []
        )
        return updated[0] if updated else row
    created = client.table('operational_alerts').insert({
        'dedupe_key': dedupe_key,
        'alert_type': alert_type,
        'severity': severity,
        'safe_details': details or {},
    }).execute().data or []
    return created[0] if created else None


def resolve_alert(client, dedupe_key: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    client.table('operational_alerts').update({
        'status': 'resolved', 'resolved_at': now, 'updated_at': now,
    }).eq('dedupe_key', dedupe_key).neq('status', 'resolved').execute()


def notify_webhook(client, alert: dict) -> bool:
    """Send a signed, bounded, sanitized alert notification when configured."""
    if not settings.operations_alert_webhook_url:
        return False
    payload = {
        'id': str(alert.get('id') or ''),
        'type': str(alert.get('alert_type') or ''),
        'severity': str(alert.get('severity') or 'warning'),
        'status': str(alert.get('status') or 'open'),
        'occurred_at': str(alert.get('last_seen_at') or ''),
        'details': alert.get('safe_details') or {},
    }
    body = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
    signature = hmac.new(
        settings.operations_alert_webhook_secret.encode(), body, hashlib.sha256,
    ).hexdigest()
    headers = {
        'Content-Type': 'application/json',
        'X-ISU-Signature': f'sha256={signature}',
    }
    delivered = False
    last_error = None
    for attempt, delay in enumerate((0.0, 0.25, 1.0), start=1):
        if delay:
            time.sleep(delay)
        try:
            response = httpx.post(
                settings.operations_alert_webhook_url, content=body, headers=headers,
                timeout=settings.operations_alert_timeout_seconds,
            )
            response.raise_for_status()
            delivered = True
            break
        except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as error:
            last_error = error
            if (
                isinstance(error, httpx.HTTPStatusError)
                and error.response.status_code < 500
                and error.response.status_code not in {408, 429}
            ):
                break
            logger.info('Operations webhook attempt %s failed', attempt)
    if not delivered:
        logger.warning('Operations webhook delivery failed (%s)', type(last_error).__name__)
        try:
            upsert_alert(
                client, 'webhook_degraded', 'webhook_degraded', 'warning',
                {'delivery_attempts': len((0.0, 0.25, 1.0))},
            )
        except Exception as persistence_error:
            logger.warning(
                'Webhook degradation alert could not be persisted (%s)',
                type(persistence_error).__name__,
            )
        return False
    resolve_alert(client, 'webhook_degraded')
    client.table('operational_alerts').update({
        'last_notified_at': datetime.now(timezone.utc).isoformat(),
    }).eq('id', alert['id']).execute()
    return True


def _notify_due(alert: dict) -> bool:
    value = alert.get('last_notified_at')
    if not value:
        return True
    try:
        previous = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return True
    return previous < datetime.now(timezone.utc) - timedelta(minutes=15)


def evaluate_operations(client) -> dict:
    """Evaluate sanitized queue/worker health and maintain deduplicated alerts."""
    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(seconds=settings.operations_worker_stale_seconds)
    queue_before = now - timedelta(seconds=settings.operations_queue_age_seconds)
    cleanup_before = now - timedelta(seconds=settings.operations_cleanup_age_seconds)
    workers = client.table('ingestion_workers').select(
        'worker_id,state,scanner_status,last_seen_at,current_job_id,version'
    ).order('last_seen_at', desc=True).limit(50).execute().data or []
    jobs = client.table('upload_jobs').select(
        'id,status,created_at,updated_at,next_retry_at,cleanup_status,'
        'failure_category,attempt_count,max_attempts'
    ).in_('status', ['queued', 'retry_wait', 'processing', 'failed', 'cancelled']).order(
        'created_at'
    ).limit(500).execute().data or []
    active_workers = [
        row for row in workers
        if row.get('state') != 'stopping' and _timestamp(row.get('last_seen_at')) >= stale_before
    ]
    allowed_scanner_states = {'healthy'}
    if settings.malware_scan_mode == 'disabled':
        allowed_scanner_states.add('disabled')
    healthy_workers = [
        row for row in active_workers if row.get('scanner_status') in allowed_scanner_states
    ]
    queued = [
        row for row in jobs
        if row.get('status') == 'queued'
        or (
            row.get('status') == 'retry_wait'
            and _timestamp(row.get('next_retry_at')) <= now
        )
    ]
    stale_queue = [
        row for row in queued
        if _timestamp(
            row.get('next_retry_at')
            if row.get('status') == 'retry_wait'
            else row.get('created_at')
        ) < queue_before
    ]
    cleanup_pending = [
        row for row in jobs
        if row.get('cleanup_status') in {'pending', 'processing'}
        and _timestamp(row.get('updated_at')) < cleanup_before
    ]
    exhausted = [
        row for row in jobs
        if row.get('status') == 'failed'
        and int(row.get('attempt_count') or 0) >= int(row.get('max_attempts') or 3)
    ]
    scanner_unavailable = [
        row for row in active_workers if row.get('scanner_status') not in allowed_scanner_states
    ]

    conditions = {
        'worker_unavailable': (
            not healthy_workers, 'worker_unavailable', 'critical',
            {'healthy_workers': len(healthy_workers)},
        ),
        'queue_depth': (
            len(queued) > settings.operations_queue_depth_threshold,
            'queue_depth', 'warning', {'queued_jobs': len(queued)},
        ),
        'queue_age': (
            bool(stale_queue), 'queue_age', 'warning', {'stale_jobs': len(stale_queue)},
        ),
        'cleanup_delayed': (
            bool(cleanup_pending), 'cleanup_delayed', 'warning',
            {'pending_cleanups': len(cleanup_pending)},
        ),
        'retries_exhausted': (
            bool(exhausted), 'retries_exhausted', 'critical',
            {'failed_jobs': len(exhausted)},
        ),
        'scanner_unavailable': (
            bool(scanner_unavailable), 'scanner_unavailable', 'critical',
            {'affected_workers': len(scanner_unavailable)},
        ),
    }
    for key, (active, alert_type, severity, details) in conditions.items():
        if active:
            alert = upsert_alert(client, key, alert_type, severity, details)
            if alert and _notify_due(alert):
                notify_webhook(client, alert)
        else:
            resolve_alert(client, key)
    return {
        'healthy_workers': len(healthy_workers),
        'registered_workers': len(workers),
        'queued_jobs': len(queued),
        'stale_jobs': len(stale_queue),
        'pending_cleanups': len(cleanup_pending),
        'failed_jobs': len(exhausted),
        'scanner_unavailable': len(scanner_unavailable),
        'status': 'healthy' if healthy_workers and not scanner_unavailable else 'degraded',
    }


def retention_report(client, *, apply: bool = False) -> dict:
    data = client.rpc('apply_operations_retention', {'p_apply': apply}).execute().data
    return data[0] if isinstance(data, list) and data else data or {}
