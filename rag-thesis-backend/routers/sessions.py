"""Chat session management (authenticated users)."""

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, sb
from models import SessionCreate, SessionUpdate

router = APIRouter(prefix='/sessions', tags=['sessions'])


def _owned_session_or_404(session_id: str, user_id: str):
    existing = sb.table('chat_sessions').select('id') \
        .eq('id', session_id).eq('user_id', user_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail='Session not found')


@router.get('')
def list_sessions(user=Depends(get_current_user)):
    res = sb.table('chat_sessions') \
        .select('*') \
        .eq('user_id', user.id) \
        .order('created_at', desc=True) \
        .execute()
    return res.data or []


@router.post('')
def create_session(session: SessionCreate, user=Depends(get_current_user)):
    res = sb.table('chat_sessions').insert({
        'user_id': user.id,
        'title': session.title,
    }).execute()
    return res.data[0] if res.data else None


@router.put('/{session_id}')
def update_session(session_id: str, session: SessionUpdate, user=Depends(get_current_user)):
    _owned_session_or_404(session_id, user.id)
    res = sb.table('chat_sessions').update({
        'title': session.title,
    }).eq('id', session_id).execute()
    return res.data[0] if res.data else None


@router.delete('/{session_id}')
def delete_session(session_id: str, user=Depends(get_current_user)):
    _owned_session_or_404(session_id, user.id)
    sb.table('chat_sessions').delete().eq('id', session_id).execute()
    return {'deleted': True}


@router.get('/{session_id}/messages')
def get_session_messages(session_id: str, user=Depends(get_current_user)):
    _owned_session_or_404(session_id, user.id)
    res = sb.table('chat_messages') \
        .select('*') \
        .eq('session_id', session_id) \
        .order('created_at', desc=False) \
        .execute()
    return res.data or []
