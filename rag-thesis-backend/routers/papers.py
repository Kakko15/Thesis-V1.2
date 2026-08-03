"""Archive metadata endpoints (indirect access model - metadata only)."""

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, require_admin, sb
from models import PaperOut
from routers.openapi_responses import errors
from services.activity import log_activity
from services.cleanup import record_storage_cleanup

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/papers', tags=['papers'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
CurrentUser = Annotated[Any, Depends(get_current_user)]
AdminUser = Annotated[Any, Depends(require_admin)]


def _ready_papers_query(fields: str, department: str | None):
    query = (
        sb.table('papers')
        .select(fields)
        .eq('ingestion_status', 'ready')
        .order('created_at', desc=True)
    )
    return query.eq('department', department) if department else query


@router.get('', response_model=list[PaperOut], responses=errors(503))
def list_papers(
    user: CurrentUser,
    department: str | None = None,
    program_id: str | None = None,
    specialization_id: str | None = None,
):
    """Return citation metadata without full text, file paths, or URLs."""
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}

    if current_profile.get('role') != 'superadmin':
        department = current_profile.get('department') or 'CCSICT'

    fields = (
        'id,title,authors,year,track,abstract,chunk_count,duplication_scan,'
        'created_at,uploaded_by,department,program_id,specialization_id,'
        'legacy_track,classification_status'
    )
    try:
        query = _ready_papers_query(fields, department)
        if program_id:
            query = query.eq('program_id', program_id)
        if specialization_id:
            query = query.eq('specialization_id', specialization_id)
        papers = query.execute().data or []
    except Exception as normalized_error:
        if program_id or specialization_id:
            raise HTTPException(
                503,
                'Program filtering is unavailable until the academic catalog migration is applied.',
            ) from normalized_error
        logger.warning(
            'Normalized paper metadata unavailable; serving legacy archive fields (%s).',
            type(normalized_error).__name__,
        )
        legacy_fields = (
            'id,title,authors,year,track,abstract,chunk_count,duplication_scan,'
            'created_at,uploaded_by,department'
        )
        papers = _ready_papers_query(legacy_fields, department).execute().data or []

    # Restrict the lookup to the uploaders actually present. This read had no
    # filter and no limit, so every archive page load transferred the entire
    # profiles table to the API process purely to map ids to display names —
    # invisible at 50 theses, thousands of rows at university scale. Mirrors
    # the pattern routers/analytics.py already uses for system logs.
    uploader_ids = list({paper['uploaded_by'] for paper in papers if paper.get('uploaded_by')})
    profiles = {}
    if uploader_ids:
        profiles_res = (
            sb.table('profiles').select('id,full_name,email')
            .in_('id', uploader_ids).execute()
        )
        profiles = {profile['id']: profile for profile in (profiles_res.data or [])}
    for paper in papers:
        uploader = profiles.get(paper.get('uploaded_by'))
        paper['uploader_name'] = (
            uploader.get('full_name') or uploader.get('email')
            if uploader else 'Unknown / System'
        )
    return papers


@router.delete('/{paper_id}', responses=errors(403, 404, 503))
def delete_paper(paper_id: str, user: AdminUser):
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

    sb.table('papers').update({'ingestion_status': 'deletion_pending'}).eq('id', paper_id).execute()
    if paper.get('storage_path'):
        try:
            sb.storage.from_('pdfs').remove([paper['storage_path']])
        except Exception as error:
            logger.exception(
                'Failed to remove private file for paper %s (%s)',
                paper_id, type(error).__name__,
            )
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
        sb.table('papers').delete().eq('id', paper_id).execute()
    except Exception as error:
        logger.error('Private file removed but database deletion remains pending for %s', paper_id)
        raise HTTPException(
            503,
            'Database deletion is pending. Retrying this deletion is safe.',
        ) from error
    log_activity(user.id, 'paper_delete', {'paper_id': paper_id, 'title': paper.get('title')})
    return {'deleted': paper_id}
