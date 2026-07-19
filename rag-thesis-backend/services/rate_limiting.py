"""Shared, signature-verified rate limiting for API routes."""

import hashlib
import jwt
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import settings


def rate_limit_key(request: Request) -> str:
    """Use a verified user ID or an IP-bound browser guest identifier."""
    if settings.supabase_jwt_secret:
        authorization = request.headers.get('authorization', '')
        if authorization.lower().startswith('bearer '):
            try:
                claims = jwt.decode(
                    authorization[7:],
                    settings.supabase_jwt_secret,
                    algorithms=['HS256'],
                    audience='authenticated',
                )
                if claims.get('sub'):
                    return f"user:{claims['sub']}"
            except jwt.InvalidTokenError:
                pass
    address = get_remote_address(request)
    guest_id = request.headers.get('x-guest-id', '')
    if 16 <= len(guest_id) <= 128 and all(char.isalnum() or char in '-_' for char in guest_id):
        digest = hashlib.sha256(f'{address}:{guest_id}'.encode()).hexdigest()[:32]
        return f'guest:{digest}'
    return f'ip:{address}'


def ip_rate_limit_key(request: Request) -> str:
    """Broad abuse ceiling that cannot be bypassed by rotating guest IDs."""
    return f'ip:{get_remote_address(request)}'


limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=['120/minute'],
    storage_uri=settings.rate_limit_storage_uri,
)
