from fastapi import Security, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import create_client
from config import settings
import logging

logger = logging.getLogger(__name__)

sb = create_client(settings.supabase_url, settings.supabase_key)
security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

def get_optional_user(credentials: HTTPAuthorizationCredentials = Security(optional_security)):
    """Validates the JWT token if present, returns None otherwise."""
    if not credentials:
        return None
    try:
        token = credentials.credentials
        res = sb.auth.get_user(token)
        if res and res.user:
            return res.user
    except Exception:
        pass
    return None

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Validates the JWT token and returns the Supabase user object."""
    try:
        token = credentials.credentials
        # The Supabase Python client currently validates the token securely
        res = sb.auth.get_user(token)
        if not res or not res.user:
            raise Exception("Invalid token")
        return res.user
    except Exception as e:
        logger.error(f"Auth error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

def require_admin(user = Security(get_current_user)):
    """Validates that the current user has the 'admin' role."""
    # Query the profiles table dynamically in case the role was changed manually in the DB
    try:
        res = sb.table('profiles').select('role').eq('id', user.id).execute()
        role = res.data[0].get('role') if res.data and len(res.data) > 0 else 'student'
    except Exception as e:
        logger.error(f"Failed to fetch user role from profiles: {str(e)}")
        role = 'student'

    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required to perform this action.",
        )
    return user
