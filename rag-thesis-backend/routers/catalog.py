"""Normalized, server-owned academic catalog API."""

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from dependencies.auth import require_superadmin, sb
from models import CatalogEntityCreate, CatalogEntityUpdate
from routers.openapi_responses import errors

router = APIRouter(prefix='/catalog', tags=['Academic catalog'])
logger = logging.getLogger(__name__)

# The Supabase SDK returns an opaque user record, so Any is the honest type.
SuperadminUser = Annotated[Any, Depends(require_superadmin)]


def _legacy_catalog() -> list[dict]:
    rows = sb.table('departments').select('*').order('created_at', desc=False).execute().data or []
    result = []
    for row in rows:
        name = str(row.get('name') or '').strip()
        result.append({
            **row,
            'code': ''.join(character for character in name.upper() if character.isalnum()),
            'active': True,
            'programs': [],
        })
    return result


def _nested_catalog(active_only: bool = True) -> list[dict]:
    try:
        departments = sb.table('departments').select('id,code,name,active').order('name').execute().data or []
        programs = sb.table('programs').select('id,department_id,code,name,active').order('code').execute().data or []
        specializations = sb.table('specializations').select(
            'id,program_id,code,name,active',
        ).order('code').execute().data or []
    except Exception as error:
        # PI-04 is additive. Keep the current production schema readable until
        # its normalized migration has been applied; genuine outages still
        # fail because this fallback uses the same Supabase connection.
        logger.warning(
            'Normalized academic catalog unavailable; serving the legacy schema (%s).',
            type(error).__name__,
        )
        return _legacy_catalog()
    specs_by_program: dict[str, list[dict]] = {}
    for item in specializations:
        if not active_only or item.get('active'):
            specs_by_program.setdefault(str(item['program_id']), []).append(item)
    programs_by_department: dict[str, list[dict]] = {}
    for item in programs:
        if active_only and not item.get('active'):
            continue
        item['specializations'] = specs_by_program.get(str(item['id']), [])
        programs_by_department.setdefault(str(item['department_id']), []).append(item)
    result = []
    for item in departments:
        if active_only and not item.get('active'):
            continue
        item['programs'] = programs_by_department.get(str(item['id']), [])
        item['track_label'] = 'Program / specialization'
        item['tracks'] = [
            spec['name'] for program in item['programs']
            for spec in program['specializations']
        ] + [program['code'] for program in item['programs'] if not program['specializations']]
        result.append(item)
    return result


@router.get('/departments')
def list_catalog():
    return {'contract_version': '2026-07-25', 'departments': _nested_catalog()}


@router.get('/departments/legacy')
def list_catalog_legacy():
    return _nested_catalog()


@router.post('/programs', status_code=status.HTTP_201_CREATED, responses=errors(422))
def create_program(body: CatalogEntityCreate, _user: SuperadminUser):
    parent = sb.table('departments').select('id').eq('id', body.parent_id).eq('active', True).execute()
    if not parent.data:
        raise HTTPException(422, 'Active parent department not found.')
    row = {'department_id': body.parent_id, 'code': body.code, 'name': body.name, 'active': True}
    return sb.table('programs').insert(row).execute().data[0]


@router.patch('/programs/{entity_id}', responses=errors(404, 422))
def update_program(entity_id: str, body: CatalogEntityUpdate, _user: SuperadminUser):
    values = body.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(422, 'At least one program field is required.')
    result = sb.table('programs').update(values).eq('id', entity_id).execute().data or []
    if not result:
        raise HTTPException(404, 'Program not found.')
    return result[0]


@router.post('/specializations', status_code=status.HTTP_201_CREATED, responses=errors(422))
def create_specialization(body: CatalogEntityCreate, _user: SuperadminUser):
    parent = sb.table('programs').select('id').eq('id', body.parent_id).eq('active', True).execute()
    if not parent.data:
        raise HTTPException(422, 'Active parent program not found.')
    row = {'program_id': body.parent_id, 'code': body.code, 'name': body.name, 'active': True}
    return sb.table('specializations').insert(row).execute().data[0]


@router.patch('/specializations/{entity_id}', responses=errors(404, 422))
def update_specialization(entity_id: str, body: CatalogEntityUpdate, _user: SuperadminUser):
    values = body.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(422, 'At least one specialization field is required.')
    result = sb.table('specializations').update(values).eq('id', entity_id).execute().data or []
    if not result:
        raise HTTPException(404, 'Specialization not found.')
    return result[0]
