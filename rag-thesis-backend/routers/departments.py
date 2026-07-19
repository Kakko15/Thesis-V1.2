"""Superadmin department-management endpoints."""

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from dependencies.auth import require_superadmin, sb
from models import DepartmentCreate, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix='/departments', tags=['Departments'])


@router.get('/', response_model=list[DepartmentOut])
def list_departments():
    """Fetch departments for server-validated filtering."""
    result = sb.table('departments').select('*').order('created_at', desc=False).execute()
    return result.data


@router.post('/', response_model=DepartmentOut)
def create_department(body: DepartmentCreate, user=Depends(require_superadmin)):
    """Create a department and its tracks."""
    existing = sb.table('departments').select('id').eq('name', body.name).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail='Department with this name already exists')

    insert_data = {
        'name': body.name,
        'track_label': body.track_label,
        'tracks': body.tracks,
    }
    result = sb.table('departments').insert(insert_data).execute()
    return result.data[0]


@router.put('/{department_id}', response_model=DepartmentOut)
def update_department(
    department_id: str,
    body: DepartmentUpdate,
    user=Depends(require_superadmin),
):
    """Update a department."""
    existing = sb.table('departments').select('*').eq('id', department_id).execute()
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
    return result.data[0]


@router.delete('/{department_id}')
def delete_department(department_id: str, user=Depends(require_superadmin)):
    """Delete a department."""
    existing = sb.table('departments').select('*').eq('id', department_id).execute()
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
