"""Institutional research analytics + user role management (admin console).

Provides the "institutional research analytics" surface described in the
thesis paper (Section 3.2.3, Phase 4) and role administration for the
three-tier access model (student / faculty / admin).
"""

import logging
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, invalidate_role_cache, require_admin, require_superadmin, sb
from models import RoleUpdate, UserUpdate, ProfileUpdate
from services.activity import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/analytics', tags=['analytics'])


def _count(table: str, **filters) -> int:
    try:
        q = sb.table(table).select('id', count='exact')
        for col, val in filters.items():
            q = q.eq(col, val)
        res = q.limit(1).execute()
        return res.count or 0
    except Exception as e:
        logger.warning('Count query failed for %s: %s', table, e)
        return 0


@router.get('/summary')
def public_summary():
    """Lightweight public stats for the landing page (no auth)."""
    papers = sb.table('papers').select('id,track,year').execute().data or []
    tracks = Counter(p.get('track') or 'Uncategorized' for p in papers)
    years = [p['year'] for p in papers if p.get('year')]
    return {
        'total_papers': len(papers),
        'total_tracks': len([t for t in tracks if t != 'Uncategorized']),
        'year_range': {'from': min(years), 'to': max(years)} if years else None,
        'total_queries': _count('activity_log', action='chat_query'),
    }


@router.get('/overview')
def overview(user=Depends(require_admin)):
    """Full analytics for the admin dashboard."""
    papers = sb.table('papers').select('id,track,year,chunk_count,created_at').execute().data or []

    papers_per_track = Counter(p.get('track') or 'Uncategorized' for p in papers)
    papers_per_year = Counter(str(p['year']) for p in papers if p.get('year'))
    total_chunks = sum(p.get('chunk_count') or 0 for p in papers)

    profiles = sb.table('profiles').select('role').execute().data or []
    users_per_role = Counter(p.get('role', 'student') for p in profiles)

    scans = sb.table('scan_history').select('duplication_percentage,created_at').execute().data or []
    scan_percentages = [s['duplication_percentage'] for s in scans if s.get('duplication_percentage') is not None]
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
            'chat_queries': _count('activity_log', action='chat_query'),
            'chat_sessions': _count('chat_sessions'),
            'novelty_scans': len(scans),
            'avg_duplication_percentage': avg_duplication,
            'flagged_scans': sum(1 for p in scan_percentages if p >= 50),
        },
    }


@router.get('/activity')
def recent_activity(limit: int = 25, user=Depends(require_admin)):
    limit = max(1, min(limit, 100))
    res = sb.table('activity_log').select('*').order('created_at', desc=True).limit(limit).execute()
    return res.data or []


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get('/users')
def list_users(user=Depends(require_admin)):
    """Admin/superadmin can list users. Admin only sees their own department. Superadmin sees all."""
    query = sb.table('profiles').select('*').order('created_at', desc=True)
    
    # Fetch current user profile to get accurate role and department
    profile_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = profile_res.data[0] if profile_res.data else {}
    
    if current_profile.get('role') != 'superadmin':
        dept = current_profile.get('department') or 'CCSICT'
        query = query.eq('department', dept).neq('role', 'superadmin')
        
    res = query.execute()
    return res.data or []


@router.put('/users/{user_id}/role')
def update_user_role(user_id: str, body: RoleUpdate, user=Depends(require_admin)):
    if user_id == user.id:
        raise HTTPException(400, 'You cannot change your own role.')
    
    current_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_res.data[0] if current_res.data else {}

    existing = sb.table('profiles').select('id,email,role,department').eq('id', user_id).execute()
    if not existing.data:
        raise HTTPException(404, 'User not found')
    target = existing.data[0]

    if current_profile.get('role') != 'superadmin':
        if target.get('department') != current_profile.get('department'):
            raise HTTPException(403, 'You can only modify users in your own department.')
        if target.get('role') == 'superadmin' or body.role == 'superadmin':
            raise HTTPException(403, 'Administrators cannot assign or modify superadmins.')

    update_data = {'role': body.role}
    if body.status:
        update_data['status'] = body.status
    else:
        update_data['status'] = 'approved'
        
    sb.table('profiles').update(update_data).eq('id', user_id).execute()
    invalidate_role_cache(user_id)
    log_activity(user.id, 'role_change', {
        'target_user': user_id,
        'target_email': existing.data[0].get('email'),
        'new_role': body.role,
        'new_status': update_data['status'],
    })
    return {'id': user_id, 'role': body.role, 'status': update_data['status']}


# ---------------------------------------------------------------------------
# Superadmin User & System Management
# ---------------------------------------------------------------------------

@router.delete('/users/{user_id}')
def delete_user(user_id: str, user=Depends(require_admin)):
    if user_id == user.id:
        raise HTTPException(400, 'You cannot delete your own account.')
    
    current_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_res.data[0] if current_res.data else {}

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
    except Exception as e:
        logger.error('Failed to delete user: %s', e)
        raise HTTPException(500, f'Failed to delete user: {e}')

@router.put('/users/{user_id}/details')
def update_user_details(user_id: str, data: UserUpdate, curr_user=Depends(require_admin)):
    """Admin/Superadmin can edit user name, role, and department."""
    current_res = sb.table('profiles').select('role,department').eq('id', curr_user.id).execute()
    current_profile = current_res.data[0] if current_res.data else {}

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

    update_data = {
        'full_name': data.full_name,
        'role': data.role,
    }
    if data.department:
        update_data['department'] = data.department
    if data.status:
        update_data['status'] = data.status

    res = sb.table('profiles').update(update_data).eq('id', user_id).execute()
    
    if not res.data:
        raise HTTPException(404, 'User not found')
        
    invalidate_role_cache(user_id)
    log_activity(curr_user.id, 'role_change', {
        'target_id': user_id, 
        'target_email': res.data[0].get('email'), 
        'new_role': data.role,
        'new_department': data.department
    })
    return res.data[0]

@router.get('/logs/system')
def get_system_logs(limit: int = 200, user=Depends(require_admin)):
    limit = max(1, min(limit, 1000))
    current_res = sb.table('profiles').select('role,department').eq('id', user.id).execute()
    current_profile = current_res.data[0] if current_res.data else {}

    # We fetch more logs initially if not superadmin because we filter in memory
    fetch_limit = limit if current_profile.get('role') == 'superadmin' else min(1000, limit * 5)
    logs_res = sb.table('activity_log').select('*').order('created_at', desc=True).limit(fetch_limit).execute()
    logs = logs_res.data or []
    
    user_ids = list({log['user_id'] for log in logs if log.get('user_id')})
    profiles = {}
    if user_ids:
        prof_res = sb.table('profiles').select('id,email,full_name,department').in_('id', user_ids).execute()
        profiles = {p['id']: p for p in (prof_res.data or [])}
        
    filtered_logs = []
    for log in logs:
        if log.get('user_id'):
            log['user'] = profiles.get(log['user_id'])
            if current_profile.get('role') != 'superadmin':
                log_dept = log['user'].get('department') if log['user'] else None
                if log_dept != current_profile.get('department'):
                    continue
        else:
            if current_profile.get('role') != 'superadmin':
                continue
        filtered_logs.append(log)
        if len(filtered_logs) >= limit:
            break
            
    return filtered_logs


# ---------------------------------------------------------------------------
# Current user profile (role resolution for the frontend)
# ---------------------------------------------------------------------------

@router.get('/me')
def my_profile(user=Depends(get_current_user)):
    res = sb.table('profiles').select('id,email,full_name,role,department,status,created_at,avatar_url').eq('id', user.id).execute()
    if res.data:
        return res.data[0]
    return {'id': user.id, 'email': user.email, 'full_name': '', 'role': 'student', 'department': 'CCSICT', 'status': 'approved'}

@router.put('/me')
def update_my_profile(data: ProfileUpdate, user=Depends(get_current_user)):
    update_data = {}
    if data.full_name is not None:
        update_data['full_name'] = data.full_name
    if data.avatar_url is not None:
        update_data['avatar_url'] = data.avatar_url
        
    if not update_data:
        return {'status': 'no changes'}
        
    res = sb.table('profiles').update(update_data).eq('id', user.id).execute()
    if res.data:
        return res.data[0]
    raise HTTPException(500, 'Failed to update profile')
