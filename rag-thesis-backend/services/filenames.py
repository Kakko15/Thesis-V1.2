"""Storage-safe and log-safe handling of client-supplied filenames.

The upload path sanitized filenames and the novelty-scan path did not, so two
endpoints accepting the same kind of file had different validation postures.
"""

import re

_UNSAFE = re.compile(r'[^A-Za-z0-9._-]+')
_MAX_STEM = 100


def sanitize_filename(filename: str | None, *, default_stem: str = 'document',
                      force_suffix: str | None = None) -> str:
    """Strip path components and unsafe characters, and cap the length.

    `force_suffix` pins the extension for a single-format endpoint; leaving it
    None preserves a safe extension from the original name, which the scan
    endpoint needs because it accepts both PDF and TXT manuscripts.
    """
    base = re.split(r'[\\/]+', filename or '')[-1]
    stem, _, suffix = base.rpartition('.')
    if not stem:  # no dot at all: rpartition puts everything in `suffix`
        stem, suffix = suffix, ''
    safe_stem = _UNSAFE.sub('_', stem).strip('._')[:_MAX_STEM] or default_stem
    if force_suffix:
        return f'{safe_stem}.{force_suffix.lstrip(".")}'
    safe_suffix = _UNSAFE.sub('', suffix)[:16].lower()
    return f'{safe_stem}.{safe_suffix}' if safe_suffix else safe_stem
