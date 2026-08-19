"""Institutional research analytics and user-role management.

Provides the institutional research analytics surface described in the thesis
paper and role administration for the student, faculty, and admin model.
"""

import logging
from collections import Counter
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from config import settings
from dependencies.auth import get_current_user, invalidate_role_cache, require_admin, sb
from models import ProfileUpdate, RoleUpdate, UserUpdate
from routers.openapi_responses import errors
from services.activity import log_activity
from services.catalog import resolve_academic_selection
from services.rate_limiting import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/analytics', tags=['analytics'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
CurrentUser = Annotated[Any, Depends(get_current_user)]
AdminUser = Annotated[Any, Depends(require_admin)]

# The audit-log and user-management listings previously used `select('*')`, which
# publishes whatever columns the table happens to have — so a future column would
# reach an administrator's browser by default. These are the complete current
# column sets, so today's payloads are byte-identical; adding a column now
# requires a deliberate edit here.
_ACTIVITY_FIELDS = 'id,user_id,action,department,detail,created_at'
_PROFILE_FIELDS = (
    'id,email,full_name,avatar_url,role,department,status,created_at,updated_at'
)


def _admin_scope(user) -> tuple[str, str | None]:
    result = sb.table('profiles').select('role,department').eq('id', user.id).limit(1).execute()
    if not result.data:
        raise HTTPException(403, 'A valid administrator profile is required.')
    profile = result.data[0]
    return profile.get('role', 'student'), profile.get('department')


# Postgres foreign-key violation. Supabase surfaces the driver error through
# several shapes depending on where it is raised, so match the SQLSTATE on the
# attributes it might carry and fall back to the rendered message.
_FK_VIOLATION_SQLSTATE = '23503'


def _is_reference_conflict(error: Exception) -> bool:
    for attribute in ('code', 'pgcode'):
        if str(getattr(error, attribute, '') or '') == _FK_VIOLATION_SQLSTATE:
            return True
    details = getattr(error, 'details', None) or getattr(error, 'message', None) or str(error)
    text = str(details).lower()
    return _FK_VIOLATION_SQLSTATE in text or 'foreign key constraint' in text


def _count(table: str, **filters) -> int:
    try:
        query = sb.table(table).select('id', count='exact')
        for column, value in filters.items():
            query = query.eq(column, value)
        result = query.limit(1).execute()
        return result.count or 0
    except Exception as error:
        logger.warning('Count query failed for %s (%s)', table, type(error).__name__)
        return 0


@router.get('/summary')
@limiter.limit(settings.rate_limit_public)
def public_summary(request: Request):
    """Return lightweight, non-sensitive landing-page statistics.

    Unauthenticated by design — the landing page calls it for every anonymous
    visitor — so it carries an explicit rate limit. Without one, only the global
    default applied and a trivial loop forced a full-table read per request.
    """
    papers = (
        sb.table('papers')
        .select('id,track,year')
        .eq('ingestion_status', 'ready')
        .eq('department', settings.thesis_evaluation_department)
        .execute()
        .data
        or []
    )
    tracks = Counter(paper.get('track') or 'Uncategorized' for paper in papers)
    years = [paper['year'] for paper in papers if paper.get('year')]
    return {
        'total_papers': len(papers),
        'total_tracks': len([track for track in tracks if track != 'Uncategorized']),
        'year_range': {'from': min(years), 'to': max(years)} if years else None,
        'total_queries': _count(
            'activity_log',
            action='chat_query',
            department=settings.thesis_evaluation_department,
        ),
    }


@router.get('/overview', responses=errors(403))
def overview(user: AdminUser):
    """Return full analytics for the admin dashboard."""
    role, department = _admin_scope(user)
    paper_query = (
        sb.table('papers')
        .select('id,track,year,chunk_count,created_at,thesis_category')
        .eq('ingestion_status', 'ready')
    )
    profile_query = sb.table('profiles').select('role')
    scan_query = sb.table('scan_history').select('duplication_percentage,created_at')
    if role != 'superadmin':
        paper_query = paper_query.eq('department', department)
        profile_query = profile_query.eq('department', department)
        scan_query = scan_query.eq('department', department)
    try:
        papers = paper_query.execute().data or []
        papers_per_category = Counter(
            paper.get('thesis_category') or 'student' for paper in papers
        )
    except Exception:
        # Pre-migration databases have no thesis_category column yet; the
        # dashboard hides the breakdown while this counter stays empty.
        legacy_query = (
            sb.table('papers')
            .select('id,track,year,chunk_count,created_at')
            .eq('ingestion_status', 'ready')
        )
        if role != 'superadmin':
            legacy_query = legacy_query.eq('department', department)
        papers = legacy_query.execute().data or []
        papers_per_category = Counter()

    papers_per_track = Counter(paper.get('track') or 'Uncategorized' for paper in papers)
    papers_per_year = Counter(str(paper['year']) for paper in papers if paper.get('year'))
    total_chunks = sum(paper.get('chunk_count') or 0 for paper in papers)

    profiles = profile_query.execute().data or []
    users_per_role = Counter(profile.get('role', 'student') for profile in profiles)

    scans = scan_query.execute().data or []
    scan_percentages = [
        scan['duplication_percentage']
        for scan in scans
        if scan.get('duplication_percentage') is not None
    ]
    avg_duplication = round(sum(scan_percentages) / len(scan_percentages), 2) if scan_percentages else 0

    return {
        'papers': {
            'total': len(papers),
            'per_track': dict(papers_per_track.most_common()),
            'per_year': dict(sorted(papers_per_year.items())),
            'per_category': dict(papers_per_category.most_common()),
            'total_chunks': total_chunks,
        },
        'users': {
            'total': len(profiles),
            'per_role': dict(users_per_role),
        },
        'usage': {
            'chat_queries': _count(
                'activity_log',
                **({'action': 'chat_query'} if role == 'superadmin' else {
                    'action': 'chat_query', 'department': department,
                }),
            ),
            'chat_sessions': _count(
                'chat_sessions',
                **({} if role == 'superadmin' else {'department': department}),
            ),
            'novelty_scans': len(scans),
            'avg_duplication_percentage': avg_duplication,
            'flagged_scans': sum(1 for percentage in scan_percentages if percentage >= 50),
        },
    }


@router.get('/activity', responses=errors(403))
def recent_activity(user: AdminUser, limit: int = 25):
    """Return recent audit activity for authorized administrators."""
    limit = max(1, min(limit, 100))
    role, department = _admin_scope(user)
    query = sb.table('activity_log').select(_ACTIVITY_FIELDS)
    if role != 'superadmin':
        query = query.eq('department', department)
    result = query.order('created_at', desc=True).limit(limit).execute()
    return result.data or []


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get('/users')
def list_users(user: AdminUser):
    """List department users for admins or all users for superadmins."""
    query = sb.table('profiles').select(_PROFILE_FIELDS).order('created_at', desc=True)

    profile_result = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_result.data[0] if profile_result.data else {}

    if current_profile.get('role') != 'superadmin':
        department = current_profile.get('department') or 'CCSICT'
        query = query.eq('department', department).neq('role', 'superadmin')

    result = query.execute()
    return result.data or []


@router.put('/users/{user_id}/role', responses=errors(400, 403, 404))
def update_user_role(user_id: str, body: RoleUpdate, user: AdminUser):
    """Update an authorized target user's role and approval status."""
    if user_id == user.id:
        raise HTTPException(400, 'You cannot change your own role.')

    current_result = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_result.data[0] if current_result.data else {}

    existing = sb.table('profiles').select('id,email,role,department').eq('id', user_id).execute()
    if not existing.data:
        raise HTTPException(404, 'User not found')
    target = existing.data[0]

    if current_profile.get('role') != 'superadmin':
        if target.get('department') != current_profile.get('department'):
            raise HTTPException(403, 'You can only modify users in your own department.')
        if target.get('role') == 'superadmin' or body.role == 'superadmin':
            raise HTTPException(403, 'Administrators cannot assign or modify superadmins.')

    update_data = {
        'role': body.role,
        'status': body.status or 'approved',
    }
    sb.table('profiles').update(update_data).eq('id', user_id).execute()
    invalidate_role_cache(user_id)
    log_activity(user.id, 'role_change', {
        'target_user': user_id,
        'target_email': target.get('email'),
        'new_role': body.role,
        'new_status': update_data['status'],
    })
    return {'id': user_id, 'role': body.role, 'status': update_data['status']}


# ---------------------------------------------------------------------------
# Superadmin user and system management
# ---------------------------------------------------------------------------

@router.delete('/users/{user_id}', responses=errors(400, 403, 404, 409, 500))
def delete_user(user_id: str, user: AdminUser):
    """Delete an authorized target user."""
    if user_id == user.id:
        raise HTTPException(400, 'You cannot delete your own account.')

    current_result = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_result.data[0] if current_result.data else {}

    existing = sb.table('profiles').select('department,role').eq('id', user_id).execute()
    if not existing.data:
        raise HTTPException(404, 'User not found')
    target = existing.data[0]

    if current_profile.get('role') != 'superadmin':
        if target.get('department') != current_profile.get('department'):
            raise HTTPException(403, 'You can only delete users in your own department.')
        if target.get('role') == 'superadmin':
            raise HTTPException(403, 'Administrators cannot delete superadmins.')

    try:
        sb.auth.admin.delete_user(user_id)
    except Exception as error:
        # A row somewhere still references this account with ON DELETE RESTRICT or
        # NO ACTION. Reported as a conflict rather than a server fault: nothing is
        # broken, the delete is refused, and the administrator can act on that.
        # Returning 500 here told them only that "something went wrong".
        if _is_reference_conflict(error):
            logger.warning('Refusing to delete user with dependent records (%s)', type(error).__name__)
            raise HTTPException(
                409,
                'This account is still referenced by records that must be kept. '
                'Reassign or remove them before deleting the account.',
            ) from error
        logger.exception('Failed to delete user (%s)', type(error).__name__)
        raise HTTPException(500, 'The user could not be deleted safely') from error

    invalidate_role_cache(user_id)
    log_activity(user.id, 'user_delete', {'deleted_user_id': user_id})
    return {'deleted': True}


@router.put('/users/{user_id}/details', responses=errors(403, 404, 422))
def update_user_details(user_id: str, data: UserUpdate, curr_user: AdminUser):
    """Edit an authorized user's name, role, department, and status."""
    current_result = sb.table('profiles').select('role,department').eq('id', curr_user.id).execute()
    current_profile = current_result.data[0] if current_result.data else {}

    existing = sb.table('profiles').select('department,role').eq('id', user_id).execute()
    if not existing.data:
        raise HTTPException(404, 'User not found')
    target = existing.data[0]

    if current_profile.get('role') != 'superadmin':
        if target.get('department') != current_profile.get('department'):
            raise HTTPException(403, 'You can only modify users in your own department.')
        if target.get('role') == 'superadmin' or data.role == 'superadmin':
            raise HTTPException(403, 'Administrators cannot modify or assign superadmins.')
        if data.department and data.department != current_profile.get('department'):
            raise HTTPException(403, 'Administrators cannot reassign users to a different department.')

    if data.department:
        department_result = (
            sb.table('departments')
            .select('name')
            .eq('name', data.department)
            .limit(1)
            .execute()
        )
        if not department_result.data:
            raise HTTPException(422, 'Unknown department')

    update_data = {
        'full_name': data.full_name,
        'role': data.role,
    }
    if data.department:
        update_data['department'] = data.department
    if data.status:
        update_data['status'] = data.status

    result = sb.table('profiles').update(update_data).eq('id', user_id).execute()
    if not result.data:
        raise HTTPException(404, 'User not found')

    invalidate_role_cache(user_id)
    log_activity(curr_user.id, 'role_change', {
        'target_id': user_id,
        'target_email': result.data[0].get('email'),
        'new_role': data.role,
        'new_department': data.department,
    })
    return result.data[0]


@router.get('/logs/system')
def get_system_logs(user: AdminUser, limit: int = 200):
    """Return department-isolated activity logs."""
    limit = max(1, min(limit, 1000))
    current_result = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_result.data[0] if current_result.data else {}

    logs_query = sb.table('activity_log').select(_ACTIVITY_FIELDS)
    if current_profile.get('role') != 'superadmin':
        logs_query = logs_query.eq('department', current_profile.get('department'))
    logs_result = logs_query.order('created_at', desc=True).limit(limit).execute()
    logs = logs_result.data or []

    user_ids = list({log['user_id'] for log in logs if log.get('user_id')})
    profiles = {}
    if user_ids:
        profile_result = (
            sb.table('profiles')
            .select('id,email,full_name,department')
            .in_('id', user_ids)
            .execute()
        )
        profiles = {profile['id']: profile for profile in (profile_result.data or [])}

    # PostgREST already applies .limit(limit), so this slice is only a defensive
    # bound for a client layer that ignores it. It replaces an in-loop
    # `if len(...) >= limit: break`, which against a limit-honouring query could
    # never fire and read as though a filter were being applied here.
    logs = logs[:limit]
    for log in logs:
        if log.get('user_id'):
            log['user'] = profiles.get(log['user_id'])

    return logs


# ---------------------------------------------------------------------------
# Current user profile (role resolution for the frontend)
# ---------------------------------------------------------------------------

@router.get('/me', responses=errors(404))
def my_profile(user: CurrentUser):
    """Return the current user's public profile fields."""
    fields = (
        'id,email,full_name,role,department,status,created_at,avatar_url,'
        'program_id,specialization_id'
    )
    try:
        result = sb.table('profiles').select(fields).eq('id', user.id).execute()
    except Exception as normalized_error:
        logger.warning(
            'Normalized profile fields unavailable; serving legacy profile fields (%s).',
            type(normalized_error).__name__,
        )
        legacy_fields = 'id,email,full_name,role,department,status,created_at,avatar_url'
        result = sb.table('profiles').select(legacy_fields).eq('id', user.id).execute()
    if result.data:
        return result.data[0]
    raise HTTPException(404, 'Profile not found')


@router.put('/me', responses=errors(422, 500, 503))
def update_my_profile(data: ProfileUpdate, user: CurrentUser):
    """Update only the current user's client-editable profile fields."""
    update_data = {}
    if data.full_name is not None:
        full_name = data.full_name.strip()
        if not full_name:
            raise HTTPException(422, 'Full name cannot be empty')
        update_data['full_name'] = full_name
    if data.avatar_url is not None:
        if data.avatar_url and not data.avatar_url.startswith(f'{user.id}/'):
            raise HTTPException(422, 'Avatar must be an image uploaded to your account')
        update_data['avatar_url'] = data.avatar_url
    if {'program_id', 'specialization_id'} & data.model_fields_set:
        profile = sb.table('profiles').select('role,department').eq('id', user.id).limit(1).execute()
        current = profile.data[0] if profile.data else {}
        try:
            selection = resolve_academic_selection(
                sb,
                department_name=current.get('department') or settings.thesis_evaluation_department,
                program_id=data.program_id,
                specialization_id=data.specialization_id,
                legacy_track=None,
                require_program=current.get('role') == 'student',
            )
        except HTTPException:
            raise
        except Exception as catalog_error:
            raise HTTPException(
                503,
                'Academic program updates are unavailable until the catalog migration is applied.',
            ) from catalog_error
        update_data['program_id'] = selection.program_id
        update_data['specialization_id'] = selection.specialization_id

    if not update_data:
        return {'status': 'no changes'}

    result = sb.table('profiles').update(update_data).eq('id', user.id).execute()
    if result.data:
        return result.data[0]
    raise HTTPException(500, 'Failed to update profile')
