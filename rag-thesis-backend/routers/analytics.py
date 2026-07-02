"""Institutional research analytics + user role management (admin console).

Provides the "institutional research analytics" surface described in the
thesis paper (Section 3.2.3, Phase 4) and role administration for the
three-tier access model (student / faculty / admin).
"""

import logging
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, invalidate_role_cache, require_admin, sb
from models import RoleUpdate
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
    res = sb.table('profiles').select('id,email,full_name,role,created_at') \
        .order('created_at', desc=True).execute()
    return res.data or []


@router.put('/users/{user_id}/role')
def update_user_role(user_id: str, body: RoleUpdate, user=Depends(require_admin)):
    if user_id == user.id:
        raise HTTPException(400, 'You cannot change your own role.')
    existing = sb.table('profiles').select('id,email,role').eq('id', user_id).execute()
    if not existing.data:
        raise HTTPException(404, 'User not found')

    sb.table('profiles').update({'role': body.role}).eq('id', user_id).execute()
    invalidate_role_cache(user_id)
    log_activity(user.id, 'role_change', {
        'target_user': user_id,
        'target_email': existing.data[0].get('email'),
        'new_role': body.role,
    })
    return {'id': user_id, 'role': body.role}


# ---------------------------------------------------------------------------
# Current user profile (role resolution for the frontend)
# ---------------------------------------------------------------------------

@router.get('/me')
def my_profile(user=Depends(get_current_user)):
    res = sb.table('profiles').select('id,email,full_name,role,created_at').eq('id', user.id).execute()
    if res.data:
        return res.data[0]
    return {'id': user.id, 'email': user.email, 'full_name': '', 'role': 'student'}
