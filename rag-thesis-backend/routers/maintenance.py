"""Superadmin-only cleanup, worker, alert, and retention operations."""

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import logging

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import require_superadmin, sb
from config import settings
from routers.openapi_responses import errors
from services.activity import log_activity
from services.db_errors import identifier_not_found
from services.operations import (
    ALERT_FIELDS,
    WORKER_FIELDS,
    evaluate_operations,
    record_security_event,
    retention_report,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/maintenance', tags=['maintenance'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
SuperadminUser = Annotated[Any, Depends(require_superadmin)]


def _worker_view(row: dict) -> dict:
    opaque_id = hashlib.sha256(str(row.get('worker_id') or '').encode()).hexdigest()[:12]
    return {
        'worker_id': opaque_id,
        'state': row.get('state'),
        'scanner_status': row.get('scanner_status'),
        'version': row.get('version'),
        'current_job_id': row.get('current_job_id'),
        'started_at': row.get('started_at'),
        'last_seen_at': row.get('last_seen_at'),
        'stopped_at': row.get('stopped_at'),
    }


@router.get('/operations/summary', responses=errors(503))
def operations_summary(user: SuperadminUser):
    try:
        return evaluate_operations(sb)
    except Exception as error:
        raise HTTPException(503, 'Operational status is temporarily unavailable') from error


@router.get('/workers', responses=errors(503))
def list_workers(user: SuperadminUser):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        rows = (
            sb.table('ingestion_workers').select(WORKER_FIELDS).gte('last_seen_at', cutoff)
            .order('last_seen_at', desc=True).limit(100).execute().data or []
        )
    except Exception as error:
        raise HTTPException(503, 'Worker registry is temporarily unavailable') from error
    return {'workers': [_worker_view(row) for row in rows]}


@router.get('/upload-jobs', responses=errors(503))
def list_upload_jobs(user: SuperadminUser, limit: int = 100):
    safe_limit = max(1, min(limit, 250))
    fields = (
        'id,department,status,stage,progress,attempt_count,max_attempts,'
        'failure_category,cleanup_status,created_at,updated_at,completed_at,'
        'cancel_requested_at,cancelled_at'
    )
    try:
        rows = (
            sb.table('upload_jobs').select(fields).order('created_at', desc=True)
            .limit(safe_limit).execute().data or []
        )
    except Exception as error:
        raise HTTPException(503, 'Upload operations are temporarily unavailable') from error
    return {'jobs': rows}


@router.get('/alerts', responses=errors(503))
def list_operational_alerts(user: SuperadminUser, limit: int = 100):
    try:
        rows = (
            sb.table('operational_alerts').select(ALERT_FIELDS).order('last_seen_at', desc=True)
            .limit(max(1, min(limit, 250))).execute().data or []
        )
    except Exception as error:
        raise HTTPException(503, 'Operational alerts are temporarily unavailable') from error
    return {'alerts': rows}


@router.post('/alerts/{alert_id}/acknowledge', responses=errors(404, 503))
def acknowledge_alert(alert_id: str, user: SuperadminUser):
    now = datetime.now(timezone.utc).isoformat()
    try:
        with identifier_not_found('Open operational alert not found'):
            rows = (
                sb.table('operational_alerts').update({
                    'status': 'acknowledged', 'acknowledged_at': now,
                    'acknowledged_by': user.id, 'updated_at': now,
                }).eq('id', alert_id).neq('status', 'resolved').execute().data or []
            )
        if not rows:
            raise HTTPException(404, 'Open operational alert not found')
        record_security_event(
            sb, 'operational_alert_acknowledged', actor_id=user.id,
            details={'alert_id': alert_id},
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, 'Operational alert could not be acknowledged') from error
    return {'id': alert_id, 'status': 'acknowledged'}


@router.post('/retention/run', responses=errors(409, 503))
def run_retention(user: SuperadminUser, apply: bool = False):
    if apply and not settings.retention_enforcement_enabled:
        raise HTTPException(409, 'Retention enforcement requires institutional approval and server enablement')
    try:
        report = retention_report(sb, apply=apply)
        record_security_event(
            sb, 'retention_run', actor_id=user.id,
            details={'applied': apply, 'counts': report},
        )
        return report
    except Exception as error:
        raise HTTPException(503, 'Retention reporting is temporarily unavailable') from error


@router.get('/retention/report', responses=errors(503))
def get_retention_report(user: SuperadminUser):
    try:
        return retention_report(sb, apply=False)
    except Exception as error:
        raise HTTPException(503, 'Retention reporting is temporarily unavailable') from error


@router.get('/storage-cleanup')
def list_pending_storage_cleanup(user: SuperadminUser):
    result = (
        sb.table('storage_cleanup_queue')
        .select('id,operation,paper_id,job_id,error_category,attempts,created_at')
        .eq('status', 'pending')
        .order('created_at')
        .execute()
    )
    return {'tasks': result.data or []}


@router.post('/storage-cleanup/{task_id}/retry', responses=errors(404, 503))
def retry_storage_cleanup(task_id: int, user: SuperadminUser):
    # `.limit(1)` rather than `.single()`, matching every other read in this
    # codebase. `.single()` sets Accept: application/vnd.pgrst.object+json, and
    # PostgREST rejects a zero-row result — postgrest-py then raises before the
    # guard below is reached, so a superadmin retrying an expunged task received
    # an unhandled 500 while the route documented a 404 it could never emit.
    result = (
        sb.table('storage_cleanup_queue')
        .select('id,operation,resource_path,paper_id,job_id,attempts,status')
        .eq('id', task_id)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(404, 'Cleanup task not found')
    task = rows[0]
    if task.get('status') == 'completed':
        return {'task_id': task_id, 'status': 'completed'}

    attempts = int(task.get('attempts') or 0) + 1
    try:
        sb.storage.from_('pdfs').remove([task['resource_path']])
        if task.get('operation') == 'delete_paper' and task.get('paper_id'):
            sb.table('papers').delete().eq('id', task['paper_id']).execute()
        sb.table('storage_cleanup_queue').update({
            'status': 'completed',
            'attempts': attempts,
            'error_category': '',
        }).eq('id', task_id).execute()
        if task.get('job_id'):
            sb.table('upload_jobs').update({
                'cleanup_status': 'completed',
                'source_stored': False,
            }).eq('id', task['job_id']).execute()
    except Exception as exc:
        logger.exception('Cleanup retry %s failed (%s)', task_id, type(exc).__name__)
        sb.table('storage_cleanup_queue').update({
            'attempts': attempts,
            'error_category': type(exc).__name__,
        }).eq('id', task_id).execute()
        raise HTTPException(503, 'Private-storage cleanup is still pending') from exc

    log_activity(user.id, 'storage_cleanup_completed', {'task_id': task_id})
    return {'task_id': task_id, 'status': 'completed'}
