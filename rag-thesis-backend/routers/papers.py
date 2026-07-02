from fastapi import APIRouter, HTTPException, Depends
from dependencies.auth import require_admin, get_current_user, sb
  
router = APIRouter(prefix='/papers', tags=['papers'])
  
@router.get('')
def list_papers(user = Depends(get_current_user)):
    res = sb.table('papers') \
        .select('id,title,authors,year,department,abstract,created_at') \
        .order('created_at', desc=True).execute()
    return res.data or []
  
@router.delete('/{paper_id}')
def delete_paper(paper_id: str, user = Depends(require_admin)):
    sb.table('papers').delete().eq('id', paper_id).execute()
    return {'deleted': paper_id}
