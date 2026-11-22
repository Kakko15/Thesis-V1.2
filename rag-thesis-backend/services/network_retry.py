"""Bounded retry policy for idempotent external read operations."""

import logging
import re
import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar('T')

_TRANSIENT_ERROR_CODES = {10035, 10053, 10054, 10060, 11001}
# Transport exception class names from httpx / httpcore / urllib3 whose str()
# payload does not always repeat the class name — e.g. httpx.RemoteProtocolError
# stringifies to "<StreamReset stream_id:1, error_code:1, remote_reset:True>".
# Matched only when the class comes from a network library: a bare name match
# would also treat unrelated errors such as `tarfile.ReadError` as transient.
_TRANSIENT_ERROR_TYPE_NAMES = frozenset({
    'RemoteProtocolError',
    'ProtocolError',
    'ReadError',
    'WriteError',
    'ConnectError',
    'PoolTimeout',
    'ReadTimeout',
    'ConnectTimeout',
})
_NETWORK_ERROR_MODULE_ROOTS = frozenset({
    'httpx', 'httpcore', 'h2', 'h11', 'urllib3', 'requests', 'aiohttp',
    'ssl', 'socket', 'grpc', 'google',
})
_TRANSIENT_MARKERS = (
    'winerror 10035',
    'would block',
    'temporarily unavailable',
    'timed out',
    'timeout',
    'connection reset',
    'connection aborted',
    'server disconnected',
    'remote protocol error',
    'remoteprotocolerror',
    'streamreset',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'resource_exhausted',
    'rate limit',
    # Google's own spellings of a transient failure. The Gemini API reports
    # these as gRPC status names ("503 UNAVAILABLE", "DEADLINE_EXCEEDED") with
    # "The model is overloaded" as the message, none of which the HTTP
    # phrasing above matches, so an overloaded embedding call during a batch of
    # novelty scans (2026-09-23) was classed as permanent.
    'model is overloaded',
    '503 unavailable',
    'deadline_exceeded',
    'deadline exceeded',
)
# Retryable HTTP statuses. Matched as a labelled status rather than as a bare
# substring: '429', '502', '503' and '504' appear inside ordinary text — row
# counts, byte sizes, identifiers, timestamps — so plain substring matching
# classified deterministic failures as transient and burned every retry on them.
_RETRYABLE_STATUSES = ('408', '429', '500', '502', '503', '504')
_STATUS_PATTERN = re.compile(
    r'(?:^|[^0-9])(?:'
    r'(?:status(?:_code)?|http|code|error)\s*[:=]?\s*(?P<labelled>\d{3})'
    r'|(?P<bare>\d{3})\s*(?:[-:]\s*)?(?:server error|client error|'
    r'bad gateway|service unavailable|gateway timeout|too many requests|'
    r'request timeout|internal server error)'
    r')(?:[^0-9]|$)',
    re.IGNORECASE,
)


def mentions_http_status(message: str, statuses: tuple[str, ...]) -> bool:
    """True when `message` names one of `statuses` as an HTTP status.

    Shared with `services.chat_notices`, whose capacity check used to look for
    the bare substring '429' -- exactly the false-positive shape the pattern
    above exists to exclude: a chunk count or identifier carrying those digits
    would have tripped a 60-second provider cooldown.
    """
    return any(
        (match.group('labelled') or match.group('bare')) in statuses
        for match in _STATUS_PATTERN.finditer(message)
    )


def _has_retryable_status(message: str) -> bool:
    return mentions_http_status(message, _RETRYABLE_STATUSES)


def _is_network_transport_type(error: BaseException) -> bool:
    error_type = type(error)
    module_root = (error_type.__module__ or '').split('.', 1)[0]
    return (
        error_type.__name__ in _TRANSIENT_ERROR_TYPE_NAMES
        and module_root in _NETWORK_ERROR_MODULE_ROOTS
    )


def _is_transient_single_error(error: BaseException) -> bool:
    if _is_network_transport_type(error):
        return True
    errno = getattr(error, 'winerror', None) or getattr(error, 'errno', None)
    status = getattr(error, 'status_code', None) or getattr(error, 'status', None)
    code = getattr(error, 'code', None)
    has_retryable_code = (
        errno in _TRANSIENT_ERROR_CODES
        or str(status) in _RETRYABLE_STATUSES
        or (isinstance(code, int) and not isinstance(code, bool) and str(code) in _RETRYABLE_STATUSES)
    )
    if has_retryable_code:
        return True
    message = str(error).lower()
    return any(marker in message for marker in _TRANSIENT_MARKERS) or _has_retryable_status(message)


def is_transient_network_error(error: BaseException) -> bool:
    """Recognize retryable transport/provider failures, including WinError 10035."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if _is_transient_single_error(current):
            return True
        current = current.__cause__ or current.__context__
    return False


def retry_transient(
    operation: Callable[[], T],
    *,
    label: str,
    attempts: int = 3,
    base_delay_seconds: float = 0.25,
    logger: logging.Logger | None = None,
) -> T:
    """Retry an idempotent operation with short exponential backoff."""
    attempts = max(1, attempts)
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as error:
            if attempt == attempts or not is_transient_network_error(error):
                raise
            delay = base_delay_seconds * (2 ** (attempt - 1))
            if logger:
                logger.warning(
                    '%s transient failure (attempt %d/%d): %s; retrying in %.2fs',
                    label,
                    attempt,
                    attempts,
                    error,
                    delay,
                )
            time.sleep(delay)
    raise RuntimeError('unreachable')
