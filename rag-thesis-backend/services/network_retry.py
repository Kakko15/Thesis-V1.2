"""Bounded retry policy for idempotent external read operations."""

import logging
import re
import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar('T')

_TRANSIENT_ERROR_CODES = {10035, 10053, 10054, 10060, 11001}
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
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'resource_exhausted',
    'rate limit',
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


def is_transient_network_error(error: BaseException) -> bool:
    """Recognize retryable transport/provider failures, including WinError 10035."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        code = getattr(current, 'winerror', None) or getattr(current, 'errno', None)
        if code in _TRANSIENT_ERROR_CODES:
            return True
        status = getattr(current, 'status_code', None) or getattr(current, 'status', None)
        if str(status) in _RETRYABLE_STATUSES:
            return True
        message = str(current).lower()
        if any(marker in message for marker in _TRANSIENT_MARKERS):
            return True
        if _has_retryable_status(message):
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
