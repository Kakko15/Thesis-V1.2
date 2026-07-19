"""Institutional research analytics and user-role management.

Provides the institutional research analytics surface described in the thesis
paper and role administration for the student, faculty, and admin model.
"""

import logging
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from dependencies.auth import get_current_user, invalidate_role_cache, require_admin, sb
from models import ProfileUpdate, RoleUpdate, UserUpdate
from services.activity import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/analytics', tags=['analytics'])


def _admin_scope(user) -> tuple[str, str | None]:
    result = sb.table('profiles').select('role,department').eq('id', user.id).limit(1).execute()
    if not result.data:
        raise HTTPException(403, 'A valid administrator profile is required.')
    profile = result.data[0]
    return profile.get('role', 'student'), profile.get('department')


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
def public_summary():
    """Return lightweight, non-sensitive landing-page statistics."""
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


@router.get('/overview')
def overview(user=Depends(require_admin)):
    """Return full analytics for the admin dashboard."""
    role, department = _admin_scope(user)
    paper_query = (
        sb.table('papers')
        .select('id,track,year,chunk_count,created_at')
        .eq('ingestion_status', 'ready')
    )
    profile_query = sb.table('profiles').select('role')
    scan_query = sb.table('scan_history').select('duplication_percentage,created_at')
    if role != 'superadmin':
        paper_query = paper_query.eq('department', department)
        profile_query = profile_query.eq('department', department)
        scan_query = scan_query.eq('department', department)
    papers = paper_query.execute().data or []

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


@router.get('/activity')
def recent_activity(limit: int = 25, user=Depends(require_admin)):
    """Return recent audit activity for authorized administrators."""
    limit = max(1, min(limit, 100))
    role, department = _admin_scope(user)
    query = sb.table('activity_log').select('*')
    if role != 'superadmin':
        query = query.eq('department', department)
    result = query.order('created_at', desc=True).limit(limit).execute()
    return result.data or []


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get('/users')
def list_users(user=Depends(require_admin)):
    """List department users for admins or all users for superadmins."""
    query = sb.table('profiles').select('*').order('created_at', desc=True)

    profile_result = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_result.data[0] if profile_result.data else {}

    if current_profile.get('role') != 'superadmin':
        department = current_profile.get('department') or 'CCSICT'
        query = query.eq('department', department).neq('role', 'superadmin')

    result = query.execute()
    return result.data or []


@router.put('/users/{user_id}/role')
def update_user_role(user_id: str, body: RoleUpdate, user=Depends(require_admin)):
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

@router.delete('/users/{user_id}')
def delete_user(user_id: str, user=Depends(require_admin)):
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
        invalidate_role_cache(user_id)
        log_activity(user.id, 'user_delete', {'deleted_user_id': user_id})
        return {'deleted': True}
    except Exception as error:
        logger.error('Failed to delete user (%s)', type(error).__name__)
        raise HTTPException(500, 'The user could not be deleted safely') from error


@router.put('/users/{user_id}/details')
def update_user_details(user_id: str, data: UserUpdate, curr_user=Depends(require_admin)):
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
def get_system_logs(limit: int = 200, user=Depends(require_admin)):
    """Return department-isolated activity logs."""
    limit = max(1, min(limit, 1000))
    current_result = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_result.data[0] if current_result.data else {}

    logs_query = sb.table('activity_log').select('*')
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

    filtered_logs = []
    for log in logs:
        if log.get('user_id'):
            log['user'] = profiles.get(log['user_id'])
        filtered_logs.append(log)
        if len(filtered_logs) >= limit:
            break

    return filtered_logs


# ---------------------------------------------------------------------------
# Current user profile (role resolution for the frontend)
# ---------------------------------------------------------------------------

@router.get('/me')
def my_profile(user=Depends(get_current_user)):
    """Return the current user's public profile fields."""
    fields = 'id,email,full_name,role,department,status,created_at,avatar_url'
    result = sb.table('profiles').select(fields).eq('id', user.id).execute()
    if result.data:
        return result.data[0]
    raise HTTPException(404, 'Profile not found')


@router.put('/me')
def update_my_profile(data: ProfileUpdate, user=Depends(get_current_user)):
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

    if not update_data:
        return {'status': 'no changes'}

    result = sb.table('profiles').update(update_data).eq('id', user.id).execute()
    if result.data:
        return result.data[0]
    raise HTTPException(500, 'Failed to update profile')
