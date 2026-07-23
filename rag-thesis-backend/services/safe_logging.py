"""Central privacy-safe logging configuration for API and worker processes."""

from __future__ import annotations

import logging
import re

_AUTH_RE = re.compile(r"(?i)(authorization|apikey|token|secret|password)(\s*[:=]\s*)([^\s,;]+)")
_BEARER_RE = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")
_QUERY_RE = re.compile(r"(https?://[^\s?]+)\?[^\s]+")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")


def redact_log_text(value: object) -> str:
    """Return text with credentials and URL query values removed."""
    text = str(value)
    text = _BEARER_RE.sub("Bearer [REDACTED]", text)
    text = _AUTH_RE.sub(r"\1\2[REDACTED]", text)
    text = _JWT_RE.sub("[REDACTED-JWT]", text)
    return _QUERY_RE.sub(r"\1?[REDACTED]", text)


class PrivacyFilter(logging.Filter):
    """Render a record once, redact it, and discard potentially unsafe args."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except (TypeError, ValueError):
            message = str(record.msg)
        record.msg = redact_log_text(message)
        record.args = ()
        return True


def configure_safe_logging() -> None:
    """Apply redaction globally and silence routine HTTP polling noise."""
    root = logging.getLogger()
    if not any(isinstance(item, PrivacyFilter) for item in root.filters):
        root.addFilter(PrivacyFilter())
    for handler in root.handlers:
        if not any(isinstance(item, PrivacyFilter) for item in handler.filters):
            handler.addFilter(PrivacyFilter())
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
