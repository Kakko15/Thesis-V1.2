"""Public runtime configuration and superadmin feature settings."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from config import settings
from dependencies.auth import get_current_user, invalidate_features_cache, require_superadmin, sb
from routers.openapi_responses import errors
from services.activity import log_activity
from services.malware import (
    invalidate_malware_setting,
    malware_scanning_enabled,
)

router = APIRouter(prefix='/settings', tags=['settings'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
CurrentUser = Annotated[Any, Depends(get_current_user)]
SuperadminUser = Annotated[Any, Depends(require_superadmin)]

DEFAULT_FEATURES = {
    'student': {'chat': True, 'archive': True, 'novelty': False, 'upload': False},
    'faculty': {'chat': True, 'archive': True, 'novelty': True, 'upload': False},
}
_FEATURE_ROLES = {'student', 'faculty'}
_FEATURE_NAMES = {'chat', 'archive', 'novelty', 'upload'}
_MALWARE_SETTING_KEY = 'malware_scanning_enabled'


class MalwareScanningUpdate(BaseModel):
    """The one global file-scanning policy exposed to superadmins."""

    model_config = ConfigDict(extra='forbid')
    enabled: bool


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
def get_features(user: CurrentUser):
    """Fetch feature toggles for all roles.

    Read-only by contract. This used to INSERT the row when it was missing, so
    any student's first page load after a fresh deployment wrote a
    system-settings row, two concurrent first loads raced on the primary key
    and surfaced a 500 instead of the payload, and because `src/api.js` retries
    GETs on transient gateway errors a retried request could attempt the insert
    twice. The row is seeded by `supabase_setup.sql`; absent simply means the
    documented defaults apply, which is what every caller already assumes.
    """
    res = sb.table('system_settings').select('value').eq('key', 'role_features').execute()
    if res.data:
        return res.data[0]['value']
    return DEFAULT_FEATURES


@router.put('/features', responses=errors(422))
def update_features(payload: dict[str, Any], user: SuperadminUser):
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


def _malware_setting_response(*, refresh: bool = False) -> dict[str, Any]:
    enabled = malware_scanning_enabled(sb, refresh=refresh)
    return {
        'enabled': enabled,
        'configured': settings.malware_scan_mode == 'clamav',
        # Scanner health is monitored by the operations surface. Do not make
        # this control wait up to CLAMAV_TIMEOUT_SECONDS merely to render.
        'status': 'enabled' if enabled else 'disabled',
    }


@router.get('/malware-scanning')
def get_malware_scanning(user: SuperadminUser):
    """Return the effective global malware-scanning policy and scanner state."""
    del user
    return _malware_setting_response(refresh=True)


@router.put('/malware-scanning', responses=errors(409, 422))
def update_malware_scanning(payload: MalwareScanningUpdate, user: SuperadminUser):
    """Enable or bypass ClamAV for every upload path (Superadmin only)."""
    if payload.enabled and settings.malware_scan_mode != 'clamav':
        raise HTTPException(
            409,
            'ClamAV is not configured on this backend. Set MALWARE_SCAN_MODE=clamav first.',
        )
    res = sb.table('system_settings').update({
        'value': payload.enabled,
    }).eq('key', _MALWARE_SETTING_KEY).execute()
    if not res.data:
        sb.table('system_settings').insert({
            'key': _MALWARE_SETTING_KEY,
            'value': payload.enabled,
            'description': 'Global ClamAV malware scanning policy for uploaded files',
        }).execute()
    invalidate_malware_setting(payload.enabled)
    log_activity(
        user.id,
        'settings_update',
        {'key': _MALWARE_SETTING_KEY, 'new_value': payload.enabled},
    )
    return {
        'message': f'Malware scanning {"enabled" if payload.enabled else "disabled"}',
        **_malware_setting_response(),
    }
