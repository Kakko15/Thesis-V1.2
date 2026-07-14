"""Archive metadata endpoints (indirect access model — metadata only)."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, require_admin, sb
from models import PaperOut
from services.activity import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/papers', tags=['papers'])


@router.get('', response_model=list[PaperOut])
def list_papers(department: str | None = None, user=Depends(get_current_user)):
    """Citation metadata only — never full text, file paths, or URLs."""
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}
    
    if current_profile.get('role') != 'superadmin':
        department = current_profile.get('department') or 'CCSICT'

    query = sb.table('papers') \
        .select('id,title,authors,year,track,abstract,chunk_count,duplication_scan,created_at,uploaded_by,department') \
        .order('created_at', desc=True)
    if department:
        query = query.eq('department', department)
    res = query.execute()
    papers = res.data or []
    
    profiles_res = sb.table('profiles').select('id,full_name,email').execute()
    profiles = {p['id']: p for p in (profiles_res.data or [])}

    for p in papers:
        uploader = profiles.get(p.get('uploaded_by'))
        p['uploader_name'] = (uploader.get('full_name') or uploader.get('email')) if uploader else 'Unknown / System'

    return papers


@router.delete('/{paper_id}')
def delete_paper(paper_id: str, user=Depends(require_admin)):
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}

    existing = sb.table('papers').select('id,title,storage_path,department').eq('id', paper_id).execute()
    if not existing.data:
        raise HTTPException(404, 'Paper not found')
    paper = existing.data[0]
    
    if current_profile.get('role') != 'superadmin' and paper.get('department') != current_profile.get('department'):
        raise HTTPException(403, 'You can only delete papers from your own department')

    # Remove the archived original from private storage
    if paper.get('storage_path'):
        try:
            sb.storage.from_('pdfs').remove([paper['storage_path']])
        except Exception as e:
            logger.warning('Failed to remove stored file %s: %s', paper['storage_path'], e)

    sb.table('papers').delete().eq('id', paper_id).execute()  # chunks cascade via FK
    log_activity(user.id, 'paper_delete', {'paper_id': paper_id, 'title': paper.get('title')})
    return {'deleted': paper_id}


@router.get('/{paper_id}/url')
def get_paper_url(paper_id: str, user=Depends(require_admin)):
    """Generate a temporary signed URL to view the original PDF. (Admin only)"""
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}

    existing = sb.table('papers').select('storage_path,department').eq('id', paper_id).execute()
    if not existing.data or not existing.data[0].get('storage_path'):
        raise HTTPException(404, 'PDF file not found for this paper')
        
    if current_profile.get('role') != 'superadmin' and existing.data[0].get('department') != current_profile.get('department'):
        raise HTTPException(403, 'You can only view PDFs from your own department')
    
    path = existing.data[0]['storage_path']
    try:
        res = sb.storage.from_('pdfs').create_signed_url(path, 60)
        # Handle dict or string response from python supabase sdk
        url = res.get('signedURL') if isinstance(res, dict) else res
        if not url:
            raise ValueError('Empty signed URL returned from Supabase')
        return {'url': url}
    except Exception as e:
        logger.error('Failed to generate signed URL for %s: %s', path, e)
        raise HTTPException(502, f'Failed to generate URL: {e}')

