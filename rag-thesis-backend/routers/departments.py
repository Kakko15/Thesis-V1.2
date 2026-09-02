"""Superadmin department-management endpoints."""

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from config import settings
from dependencies.auth import require_superadmin, sb
from models import DepartmentCreate, DepartmentOut, DepartmentUpdate
from routers.openapi_responses import errors
from services.db_errors import is_unique_violation
from services.rate_limiting import limiter

router = APIRouter(prefix='/departments', tags=['Departments'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
SuperadminUser = Annotated[Any, Depends(require_superadmin)]

# Every read pins its columns rather than publishing whatever the table happens
# to have; `code` and `active` arrived in a later migration, so a `select('*')`
# would have started leaking them silently.
_DEPARTMENT_COLUMNS = 'id,name,code,track_label,tracks,created_at'

# Mirrors the backfill in 20260725_normalized_academic_catalog.sql:
#   upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))
# so a department created through the API gets the same code the migration
# would have given it. Department names in this deployment are already the short
# institutional codes (CCSICT, CAS, COE), which is why deriving is the sensible
# default rather than a guess.
_NON_CODE_CHARACTERS = re.compile(r'[^A-Za-z0-9]+')
_MAX_DERIVED_CODE_LENGTH = 24


def _derive_code(name: str) -> str:
    """The code migration 20260725 would have assigned to `name`."""
    return _NON_CODE_CHARACTERS.sub('', name).upper()


def _resolve_code(body: DepartmentCreate) -> str:
    """The explicit code, or one derived from the name; 422 when underivable."""
    if body.code:
        return body.code
    derived = _derive_code(body.name)
    if not derived:
        raise HTTPException(
            status_code=422,
            detail='A department code could not be derived from this name. '
                   'Supply "code" explicitly, using A-Z, 0-9 and hyphens.',
        )
    if len(derived) > _MAX_DERIVED_CODE_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f'A code derived from this name would be {len(derived)} characters. '
                   f'Supply "code" explicitly, at most {_MAX_DERIVED_CODE_LENGTH} characters.',
        )
    return derived


@router.get('/', response_model=list[DepartmentOut])
@limiter.limit(settings.rate_limit_public)
def list_departments(request: Request):
    """Fetch departments for server-validated filtering.

    Unauthenticated like the catalog reads, so it carries the same explicit
    limit. The response model also pins the exposed columns, replacing a
    `select('*')` that would have published any future column by default.
    """
    result = (
        sb.table('departments')
        .select(_DEPARTMENT_COLUMNS)
        .order('created_at', desc=False).execute()
    )
    return result.data or []


@router.post('/', response_model=DepartmentOut, responses=errors(400, 409, 422))
def create_department(body: DepartmentCreate, user: SuperadminUser):
    """Create a department and its tracks."""
    existing = sb.table('departments').select('id').eq('name', body.name).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail='Department with this name already exists')

    insert_data = {
        'name': body.name,
        # NOT NULL with no default since 20260725; omitting it made every create
        # on a fully migrated project a not-null violation surfaced as a 500.
        'code': _resolve_code(body),
        'track_label': body.track_label,
        'tracks': body.tracks,
    }
    try:
        result = sb.table('departments').insert(insert_data).execute()
    except Exception as error:
        # departments_code_uq is separate from the name check above, so a code
        # collision is reachable even when the name is free.
        if is_unique_violation(error):
            raise HTTPException(
                status_code=409,
                detail=f'Department code {insert_data["code"]} is already in use.',
            ) from error
        raise
    if not result.data:
        # PostgREST does not always return a representation; indexing [0] blind
        # turned that into an unhandled 500 with nothing to act on.
        raise HTTPException(
            status_code=502,
            detail='The department was submitted but the database did not confirm it. '
                   'Reload the department list before retrying.',
        )
    return result.data[0]


@router.put('/{department_id}', response_model=DepartmentOut, responses=errors(400, 404, 409, 422))
def update_department(
    department_id: str,
    body: DepartmentUpdate,
    user: SuperadminUser,
):
    """Update a department."""
    # Returned directly at the no-op branch below, so this pins the response
    # columns rather than publishing whatever the table happens to have.
    existing = (
        sb.table('departments')
        .select(_DEPARTMENT_COLUMNS)
        .eq('id', department_id).execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail='Department not found')

    update_data = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail='Department name cannot be empty')
        current_name = existing.data[0]['name']
        if current_name == settings.thesis_evaluation_department and name != current_name:
            raise HTTPException(
                status_code=409,
                detail='The formal evaluation department cannot be renamed',
            )
        if name != current_name:
            conflict = sb.table('departments').select('id').eq('name', name).execute()
            if conflict.data:
                raise HTTPException(status_code=400, detail='Department with this name already exists')
        update_data['name'] = name
    if body.track_label is not None:
        update_data['track_label'] = body.track_label
    if body.tracks is not None:
        update_data['tracks'] = body.tracks

    if not update_data:
        return existing.data[0]

    result = sb.table('departments').update(update_data).eq('id', department_id).execute()
    if not result.data:
        raise HTTPException(
            status_code=502,
            detail='The department update was submitted but the database did not confirm it. '
                   'Reload the department list before retrying.',
        )
    return result.data[0]


@router.delete('/{department_id}', responses=errors(404, 409))
def delete_department(department_id: str, user: SuperadminUser):
    """Delete a department."""
    # Only the name is read, and nothing here reaches the client.
    existing = sb.table('departments').select('name').eq('id', department_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail='Department not found')

    department_name = existing.data[0]['name']
    if department_name == settings.thesis_evaluation_department:
        raise HTTPException(status_code=409, detail='The formal evaluation department cannot be deleted')

    references = {
        'profiles': sb.table('profiles').select('id', count='exact').eq(
            'department', department_name,
        ).limit(1).execute().count or 0,
        'papers': sb.table('papers').select('id', count='exact').eq(
            'department', department_name,
        ).limit(1).execute().count or 0,
        'scans': sb.table('scan_history').select('id', count='exact').eq(
            'department', department_name,
        ).limit(1).execute().count or 0,
        'conversations': sb.table('chat_sessions').select('id', count='exact').eq(
            'department', department_name,
        ).limit(1).execute().count or 0,
        'uploads': sb.table('upload_jobs').select('id', count='exact').eq(
            'department', department_name,
        ).limit(1).execute().count or 0,
        'activity': sb.table('activity_log').select('id', count='exact').eq(
            'department', department_name,
        ).limit(1).execute().count or 0,
    }
    if any(references.values()):
        raise HTTPException(
            status_code=409,
            detail='Department still has institutional records and cannot be deleted',
        )

    sb.table('departments').delete().eq('id', department_id).execute()
    return {'message': 'Department deleted successfully'}
