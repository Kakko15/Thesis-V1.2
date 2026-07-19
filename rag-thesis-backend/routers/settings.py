"""Public runtime configuration and superadmin feature settings."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from dependencies.auth import get_current_user, invalidate_features_cache, require_superadmin, sb
from services.activity import log_activity

router = APIRouter(prefix='/settings', tags=['settings'])

DEFAULT_FEATURES = {
    'student': {'chat': True, 'archive': True, 'novelty': False, 'upload': False},
    'faculty': {'chat': True, 'archive': True, 'novelty': True, 'upload': False},
}
_FEATURE_ROLES = {'student', 'faculty'}
_FEATURE_NAMES = {'chat', 'archive', 'novelty', 'upload'}


def _validated_features(payload: dict[str, Any]) -> dict[str, dict[str, bool]]:
    if set(payload) != _FEATURE_ROLES:
        raise HTTPException(422, 'Feature settings must define student and faculty roles')
    result = {}
    for role, values in payload.items():
        if not isinstance(values, dict) or set(values) != _FEATURE_NAMES:
            raise HTTPException(422, f'Invalid feature settings for {role}')
        if any(not isinstance(value, bool) for value in values.values()):
            raise HTTPException(422, 'Feature settings must use boolean values')
        result[role] = values
    return result


@router.get('/public')
def get_public_settings():
    """Expose only the non-sensitive formal evaluation scope."""
    return {'evaluation_department': settings.thesis_evaluation_department}


@router.get('/features')
def get_features(user=Depends(get_current_user)):
    """Fetch feature toggles for all roles."""
    res = sb.table('system_settings').select('value').eq('key', 'role_features').execute()
    if res.data:
        return res.data[0]['value']

    sb.table('system_settings').insert({
        'key': 'role_features',
        'value': DEFAULT_FEATURES,
        'description': 'Role-based access permissions for system features',
    }).execute()
    return DEFAULT_FEATURES


@router.put('/features')
def update_features(payload: dict[str, Any], user=Depends(require_superadmin)):
    """Update feature toggles (Superadmin only)."""
    payload = _validated_features(payload)
    res = sb.table('system_settings').update({
        'value': payload,
    }).eq('key', 'role_features').execute()

    if not res.data:
        sb.table('system_settings').insert({
            'key': 'role_features',
            'value': payload,
            'description': 'Role-based access permissions for system features',
        }).execute()

    invalidate_features_cache()
    log_activity(user.id, 'settings_update', {'key': 'role_features', 'new_value': payload})
    return {'message': 'Features updated successfully', 'features': payload}
