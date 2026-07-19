"""Archive metadata endpoints (indirect access model — metadata only)."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, require_admin, sb
from models import PaperOut
from services.activity import log_activity
from services.cleanup import record_storage_cleanup

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/papers', tags=['papers'])


@router.get('', response_model=list[PaperOut])
def list_papers(department: str | None = None, user=Depends(get_current_user)):
    """Return citation metadata without full text, file paths, or URLs."""
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}

    if current_profile.get('role') != 'superadmin':
        department = current_profile.get('department') or 'CCSICT'

    fields = (
        'id,title,authors,year,track,abstract,chunk_count,duplication_scan,'
        'created_at,uploaded_by,department'
    )
    query = (
        sb.table('papers')
        .select(fields)
        .eq('ingestion_status', 'ready')
        .order('created_at', desc=True)
    )
    if department:
        query = query.eq('department', department)
    res = query.execute()
    papers = res.data or []

    profiles_res = sb.table('profiles').select('id,full_name,email').execute()
    profiles = {profile['id']: profile for profile in (profiles_res.data or [])}

    for paper in papers:
        uploader = profiles.get(paper.get('uploaded_by'))
        paper['uploader_name'] = (
            uploader.get('full_name') or uploader.get('email')
            if uploader
            else 'Unknown / System'
        )

    return papers


@router.delete('/{paper_id}')
def delete_paper(paper_id: str, user=Depends(require_admin)):
    """Safely delete a paper and its private original."""
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}

    existing = sb.table('papers').select(
        'id,title,storage_path,department,ingestion_status',
    ).eq('id', paper_id).execute()
    if not existing.data:
        raise HTTPException(404, 'Paper not found')
    paper = existing.data[0]

    if (
        current_profile.get('role') != 'superadmin'
        and paper.get('department') != current_profile.get('department')
    ):
        raise HTTPException(403, 'You can only delete papers from your own department')

    # Hide the record from retrieval before touching its private original.
    sb.table('papers').update({'ingestion_status': 'deletion_pending'}).eq('id', paper_id).execute()

    # Storage is outside PostgreSQL transactions. A failure keeps the database
    # row in deletion_pending and records a retryable cleanup task.
    if paper.get('storage_path'):
        try:
            sb.storage.from_('pdfs').remove([paper['storage_path']])
        except Exception as error:
            logger.error('Failed to remove private file for paper %s (%s)', paper_id, type(error).__name__)
            record_storage_cleanup(
                sb,
                operation='delete_paper',
                resource_path=paper['storage_path'],
                paper_id=paper_id,
                error=error,
            )
            log_activity(user.id, 'paper_delete_pending', {'paper_id': paper_id})
            raise HTTPException(
                503,
                'Private-file deletion is pending. The paper was hidden and can be retried safely.',
            ) from error

    try:
        sb.table('papers').delete().eq('id', paper_id).execute()  # chunks cascade via FK
    except Exception as error:
        logger.error('Private file removed but database deletion remains pending for %s', paper_id)
        raise HTTPException(
            503,
            'Database deletion is pending. Retrying this deletion is safe.',
        ) from error
    log_activity(user.id, 'paper_delete', {'paper_id': paper_id, 'title': paper.get('title')})
    return {'deleted': paper_id}
