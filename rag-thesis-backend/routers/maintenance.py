"""Superadmin-only recovery operations for failed private-storage cleanup."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import require_superadmin, sb
from services.activity import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/maintenance', tags=['maintenance'])


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
