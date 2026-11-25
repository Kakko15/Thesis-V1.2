"""Chat session management (authenticated users)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, get_user_scope, sb
from models import SessionCreate, SessionUpdate
from routers.openapi_responses import errors
from services.db_errors import identifier_not_found

router = APIRouter(prefix='/sessions', tags=['sessions'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
CurrentUser = Annotated[Any, Depends(get_current_user)]

# Both listings previously used `select('*')`, which publishes whatever columns
# the table happens to have — so any future column would reach the client by
# default. These lists are the complete current column set, so today's payloads
# are unchanged; adding a column now requires a deliberate edit here.
_SESSION_FIELDS = 'id,user_id,title,department,created_at'
# `kind` is included deliberately (B14): the transcript keeps showing system
# notices, so the client needs to know which rows are notices rather than
# research answers.
_MESSAGE_FIELDS = 'id,session_id,question,answer,sources,duplication_alert,kind,created_at'


def _owned_session_or_404(session_id: str, user_id: str):
    # `chat_sessions.id` is a uuid column, so a mistyped identifier is rejected
    # by Postgres instead of returning no rows. Without this guard that opaque
    # driver error reached the client as an unhandled 500 from a route that
    # documents 404 for exactly this case.
    with identifier_not_found('Session not found'):
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
        .select(_SESSION_FIELDS)
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
    # Ownership rides on the same request as the read: the inner join keeps
    # only rows whose session belongs to the caller, so another account's
    # session id yields nothing. A separate ownership probe followed by the read
    # cost one extra Supabase round trip (~80 ms measured 2026-11-24) on every
    # conversation opened from the sidebar. The probe now runs only when the
    # join returns nothing, to keep 404 for a missing or foreign session apart
    # from a real session that simply has no saved turns yet.
    with identifier_not_found('Session not found'):
        res = (
            sb.table('chat_messages')
            .select(f'{_MESSAGE_FIELDS},chat_sessions!inner(user_id)')
            .eq('session_id', session_id)
            .eq('chat_sessions.user_id', user.id)
            .order('created_at', desc=False)
            .execute()
        )
    messages = res.data or []
    if not messages:
        _owned_session_or_404(session_id, user.id)
    # `notice_type` is a presentation hint derived from canonical backend text;
    # it needs no database column and old conversations render consistently.
    from services.chat_notices import notice_type
    for message in messages:
        # The embedded owner exists only to filter; it is not part of the payload.
        message.pop('chat_sessions', None)
        message['notice_type'] = notice_type(message.get('answer', ''))
    return messages
