"""Superadmin-only cleanup, worker, alert, and retention operations."""

import hashlib
from datetime import datetime, timedelta, timezone

import logging

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import require_superadmin, sb
from config import settings
from services.activity import log_activity
from services.operations import evaluate_operations, record_security_event, retention_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/maintenance', tags=['maintenance'])


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


@router.get('/operations/summary')
def operations_summary(user=Depends(require_superadmin)):
    try:
        return evaluate_operations(sb)
    except Exception as error:
        raise HTTPException(503, 'Operational status is temporarily unavailable') from error


@router.get('/workers')
def list_workers(user=Depends(require_superadmin)):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        rows = (
            sb.table('ingestion_workers').select('*').gte('last_seen_at', cutoff)
            .order('last_seen_at', desc=True).limit(100).execute().data or []
        )
    except Exception as error:
        raise HTTPException(503, 'Worker registry is temporarily unavailable') from error
    return {'workers': [_worker_view(row) for row in rows]}


@router.get('/upload-jobs')
def list_upload_jobs(limit: int = 100, user=Depends(require_superadmin)):
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


@router.get('/alerts')
def list_operational_alerts(limit: int = 100, user=Depends(require_superadmin)):
    try:
        rows = (
            sb.table('operational_alerts').select('*').order('last_seen_at', desc=True)
            .limit(max(1, min(limit, 250))).execute().data or []
        )
    except Exception as error:
        raise HTTPException(503, 'Operational alerts are temporarily unavailable') from error
    return {'alerts': rows}


@router.post('/alerts/{alert_id}/acknowledge')
def acknowledge_alert(alert_id: str, user=Depends(require_superadmin)):
    now = datetime.now(timezone.utc).isoformat()
    try:
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


@router.post('/retention/run')
def run_retention(apply: bool = False, user=Depends(require_superadmin)):
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


@router.get('/retention/report')
def get_retention_report(user=Depends(require_superadmin)):
    try:
        return retention_report(sb, apply=False)
    except Exception as error:
        raise HTTPException(503, 'Retention reporting is temporarily unavailable') from error


@router.get('/storage-cleanup')
def list_pending_storage_cleanup(user=Depends(require_superadmin)):
    result = (
        sb.table('storage_cleanup_queue')
        .select('id,operation,paper_id,job_id,error_category,attempts,created_at')
        .eq('status', 'pending')
        .order('created_at')
        .execute()
    )
    return {'tasks': result.data or []}


@router.post('/storage-cleanup/{task_id}/retry')
def retry_storage_cleanup(task_id: int, user=Depends(require_superadmin)):
    result = (
        sb.table('storage_cleanup_queue')
        .select('id,operation,resource_path,paper_id,job_id,attempts,status')
        .eq('id', task_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(404, 'Cleanup task not found')
    task = result.data
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
        logger.error('Cleanup retry %s failed (%s)', task_id, type(exc).__name__)
        sb.table('storage_cleanup_queue').update({
            'attempts': attempts,
            'error_category': type(exc).__name__,
        }).eq('id', task_id).execute()
        raise HTTPException(503, 'Private-storage cleanup is still pending') from exc

    log_activity(user.id, 'storage_cleanup_completed', {'task_id': task_id})
    return {'task_id': task_id, 'status': 'completed'}
