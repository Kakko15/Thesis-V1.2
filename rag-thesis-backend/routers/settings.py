import logging
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException

from dependencies.auth import get_current_user, require_superadmin, invalidate_features_cache, sb
from services.activity import log_activity

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/settings', tags=['settings'])

DEFAULT_FEATURES = {
    "student": {"chat": True, "archive": True, "novelty": False, "upload": False},
    "faculty": {"chat": True, "archive": True, "novelty": True, "upload": False}
}

@router.get('/features')
def get_features(user=Depends(get_current_user)):
    """Fetch feature toggles for all roles."""
    res = sb.table('system_settings').select('value').eq('key', 'role_features').execute()
    if res.data and len(res.data) > 0:
        return res.data[0]['value']
    
    # If not exists, insert default and return
    sb.table('system_settings').insert({
        'key': 'role_features',
        'value': DEFAULT_FEATURES,
        'description': 'Role-based access permissions for system features'
    }).execute()
    return DEFAULT_FEATURES

@router.put('/features')
def update_features(payload: Dict[str, Any], user=Depends(require_superadmin)):
    """Update feature toggles (Superadmin only)."""
    res = sb.table('system_settings').update({
        'value': payload
    }).eq('key', 'role_features').execute()
    
    if not res.data:
        # If it didn't exist for some reason, insert it
        sb.table('system_settings').insert({
            'key': 'role_features',
            'value': payload,
            'description': 'Role-based access permissions for system features'
        }).execute()
        
    invalidate_features_cache()
    log_activity(user.id, 'settings_update', {'key': 'role_features', 'new_value': payload})
    return {"message": "Features updated successfully", "features": payload}
