"""Shared, signature-verified rate limiting for API routes."""

import hashlib
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import settings
from dependencies.auth import cached_token_subject

# The one route a signed-out visitor may use repeatedly from a shared address.
_GUEST_CHAT_PATH = '/chat'


def rate_limit_key(request: Request) -> str:
    """The bucket a request is counted in.

    * A signed-in caller: their verified user id. This used to require an HS256
      shared secret, but this project signs with ES256, so every signed-in
      request fell through to the guest or IP buckets below -- a campus behind
      one NAT shared one upload/scan allowance, and any caller could mint a
      fresh bucket per request (measured 2026-11-25 review).
    * A guest asking /chat: an IP-bound browser id, so classmates behind one
      NAT do not share a chat allowance. Rotating it cannot exceed the separate
      per-IP chat ceiling (`ip_rate_limit_key`).
    * Everything else: the client IP. A client-chosen X-Guest-ID no longer
      creates a fresh bucket on the public, upload or scan limits.
    """
    authorization = request.headers.get('authorization', '')
    if authorization.lower().startswith('bearer '):
        subject = cached_token_subject(authorization[7:].strip())
        if subject:
            return f'user:{subject}'
    address = get_remote_address(request)
    if request.url.path.rstrip('/') == _GUEST_CHAT_PATH:
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
