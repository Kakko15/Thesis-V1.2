from fastapi import APIRouter, HTTPException, Header
from supabase import create_client
from config import settings
 
router = APIRouter(prefix='/papers', tags=['papers'])
sb = create_client(settings.supabase_url, settings.supabase_key)
 
@router.get('')
def list_papers():
    res = sb.table('papers') \
        .select('id,title,authors,year,abstract,created_at') \
        .order('created_at', desc=True).execute()
    return res.data or []
 
@router.delete('/{paper_id}')
def delete_paper(paper_id: str, x_admin_secret: str = Header(default='')):
    if x_admin_secret != settings.admin_secret:
        raise HTTPException(403, 'Invalid admin secret')
    sb.table('papers').delete().eq('id', paper_id).execute()
    return {'deleted': paper_id}
