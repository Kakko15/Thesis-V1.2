"""Chat session management (authenticated users)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, get_user_scope, sb
from models import SessionCreate, SessionUpdate
from routers.openapi_responses import errors

router = APIRouter(prefix='/sessions', tags=['sessions'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
CurrentUser = Annotated[Any, Depends(get_current_user)]


def _owned_session_or_404(session_id: str, user_id: str):
    existing = (
        sb.table('chat_sessions')
        .select('id')
        .eq('id', session_id)
        .eq('user_id', user_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail='Session not found')


@router.get('')
def list_sessions(user: CurrentUser):
    res = (
        sb.table('chat_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', desc=True)
        .execute()
    )
    return res.data or []


@router.post('')
def create_session(session: SessionCreate, user: CurrentUser):
    scope = get_user_scope(user.id)
    res = sb.table('chat_sessions').insert({
        'user_id': user.id,
        'title': session.title,
        'department': scope['department'],
    }).execute()
    return res.data[0] if res.data else None


@router.put('/{session_id}', responses=errors(404))
def update_session(session_id: str, session: SessionUpdate, user: CurrentUser):
    _owned_session_or_404(session_id, user.id)
    res = sb.table('chat_sessions').update({
        'title': session.title,
    }).eq('id', session_id).execute()
    return res.data[0] if res.data else None


@router.delete('/{session_id}', responses=errors(404))
def delete_session(session_id: str, user: CurrentUser):
    _owned_session_or_404(session_id, user.id)
    sb.table('chat_sessions').delete().eq('id', session_id).execute()
    return {'deleted': True}


@router.get('/{session_id}/messages', responses=errors(404))
def get_session_messages(session_id: str, user: CurrentUser):
    _owned_session_or_404(session_id, user.id)
    res = (
        sb.table('chat_messages')
        .select('*')
        .eq('session_id', session_id)
        .order('created_at', desc=False)
        .execute()
    )
    return res.data or []
