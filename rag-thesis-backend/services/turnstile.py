"""Cloudflare Turnstile guard for guest chat.

Guest identifiers are minted by the browser, so per-guest rate limits alone
cannot stop a script that rotates fresh IDs to spend Gemini quota. When
``TURNSTILE_SECRET_KEY`` is configured, the first guest chat request must carry
a Turnstile token that Cloudflare verifies server-side; the guest ID is then
remembered for ``turnstile_guest_ttl_seconds`` so later messages skip the
challenge. An empty secret disables the guard entirely (default), keeping
development, tests, and the frozen thesis-evaluation pipeline unchanged.

The verified-guest cache is in-process, matching the current single-process
API deployment. A multi-replica deployment must move this cache to the shared
Redis store that already backs rate limiting.
"""

import logging
import threading
import time

import httpx
from fastapi import HTTPException

from config import settings

logger = logging.getLogger(__name__)

VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
VERIFICATION_HEADER = 'X-Guest-Verification'
REQUIRED_MESSAGE = 'Please complete the security check to continue as a guest.'
FAILED_MESSAGE = 'Security check failed or expired. Please try the check again.'

_cache_lock = threading.Lock()
_verified_guests: dict[str, float] = {}


def guard_enabled() -> bool:
    """The guard runs only when a Turnstile secret is configured."""
    return bool(settings.turnstile_secret_key)


def _prune_expired(now: float) -> None:
    expired = [guest for guest, expiry in _verified_guests.items() if expiry <= now]
    for guest in expired:
        del _verified_guests[guest]


def is_guest_verified(guest_id: str) -> bool:
    now = time.monotonic()
    with _cache_lock:
        _prune_expired(now)
        return _verified_guests.get(guest_id, 0.0) > now


def mark_guest_verified(guest_id: str) -> None:
    now = time.monotonic()
    with _cache_lock:
        _prune_expired(now)
        _verified_guests[guest_id] = now + settings.turnstile_guest_ttl_seconds


def reset_guest_verifications() -> None:
    """Test hook: clear the in-process verified-guest cache."""
    with _cache_lock:
        _verified_guests.clear()


async def verify_turnstile_token(token: str, remote_ip: str | None) -> bool:
    """Ask Cloudflare to verify one token. Fail closed on any error."""
    payload = {'secret': settings.turnstile_secret_key, 'response': token}
    if remote_ip:
        payload['remoteip'] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=settings.turnstile_verify_timeout_seconds) as client:
            response = await client.post(VERIFY_URL, data=payload)
            response.raise_for_status()
            return bool(response.json().get('success'))
    except (httpx.HTTPError, ValueError) as error:
        logger.warning('Turnstile verification unavailable: %s', type(error).__name__)
        return False


async def ensure_guest_chat_verification(request, user) -> None:
    """Reject unverified guest chat requests while the guard is enabled.

    Authenticated users are never challenged. Runs in the route wrapper only,
    so the evaluation harness's direct ``_chat_impl`` path stays untouched.
    """
    if user is not None or not guard_enabled():
        return
    guest_id = (request.headers.get('X-Guest-ID') or '').strip()
    if guest_id and is_guest_verified(guest_id):
        return
    token = (request.headers.get('X-Turnstile-Token') or '').strip()
    if not guest_id or not token:
        raise HTTPException(
            status_code=403,
            detail=REQUIRED_MESSAGE,
            headers={VERIFICATION_HEADER: 'required'},
        )
    client = getattr(request, 'client', None)
    remote_ip = getattr(client, 'host', None) if client else None
    if not await verify_turnstile_token(token, remote_ip):
        raise HTTPException(
            status_code=403,
            detail=FAILED_MESSAGE,
            headers={VERIFICATION_HEADER: 'failed'},
        )
    mark_guest_verified(guest_id)
