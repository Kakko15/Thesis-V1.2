"""Bounded retry policy for idempotent external read operations."""

import logging
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
    '429',
    '502',
    '503',
    '504',
)


def is_transient_network_error(error: BaseException) -> bool:
    """Recognize retryable transport/provider failures, including WinError 10035."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        code = getattr(current, 'winerror', None) or getattr(current, 'errno', None)
        if code in _TRANSIENT_ERROR_CODES:
            return True
        message = str(current).lower()
        if any(marker in message for marker in _TRANSIENT_MARKERS):
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
