"""Reject an oversized request body before anything reads or spools it.

FastAPI parses the body BEFORE it resolves dependencies: `get_request_handler`
runs `body = await request.form()` and only then calls `solve_dependencies`,
which is where `require_upload_access` lives. Starlette's MultiPartParser
spools each file part into a `SpooledTemporaryFile(max_size=1MB)`, so every
byte past the first megabyte of every part is written to the container's
temporary disk. Nothing in this application bounded that: `_read_limited_upload`
in routers/upload.py caps the bytes the handler pulls into memory, which happens
after the spool, and no proxy in this repository fronts the API (the nginx
config serves the built frontend).

The consequence, measured by source review on 2026-09-12: an entirely
unauthenticated caller could POST a body of any size to /upload/paper,
/upload/batch, /upload/extract-metadata, /upload/batch/extract-metadata or
/duplication/scan and have the whole of it written to disk before receiving
401, with concurrent requests multiplying it.

This middleware is the missing ceiling. It is deliberately a plain ASGI
middleware rather than a BaseHTTPMiddleware dispatch function, because only the
ASGI form can see the request before the body is consumed and can interpose on
the receive channel.
"""

import json
import logging

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config import settings

logger = logging.getLogger(__name__)

_MEGABYTE = 1024 * 1024

# Only these carry a body worth bounding; a GET has none to spool.
_BODY_METHODS = frozenset({'POST', 'PUT', 'PATCH'})

# The batch endpoints legitimately carry a whole shelf of manuscripts, so they
# get max_batch_files worth of allowance rather than one manuscript's.
_BATCH_PATHS = frozenset({'/upload/batch', '/upload/batch/extract-metadata'})

# Multipart boundaries, the `rows` JSON and the ordinary form fields all ride
# along with the files. These allowances are deliberately generous: the job is
# to bound an unbounded body, not to second-guess a legitimate submission by a
# megabyte. Keeping the slack above zero also means a request that is merely
# over the per-file limit still reaches the handler, which rejects it with the
# precise 413 message the clients and tests already expect, and only a request
# far past any plausible submission is stopped out here.
_SINGLE_SLACK_BYTES = 2 * _MEGABYTE
_BATCH_SLACK_BYTES = 8 * _MEGABYTE


class BodyTooLarge(Exception):
    """Signalled from the wrapped receive channel once the ceiling is passed."""


def limit_for_path(path: str) -> int:
    """Largest body, in bytes, this path could legitimately carry."""
    if path in _BATCH_PATHS:
        return (
            settings.max_batch_files * settings.max_upload_mb * _MEGABYTE
            + _BATCH_SLACK_BYTES
        )
    return settings.max_upload_mb * _MEGABYTE + _SINGLE_SLACK_BYTES


def _declared_length(scope: Scope) -> int | None:
    """The caller's own Content-Length, when it sent a usable one."""
    raw = Headers(scope=scope).get('content-length')
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


async def _send_too_large(send: Send, limit: int) -> None:
    payload = json.dumps({
        'detail': f'Request body exceeds the {limit // _MEGABYTE} MB limit',
    }).encode()
    await send({
        'type': 'http.response.start',
        'status': 413,
        'headers': [
            (b'content-type', b'application/json'),
            (b'content-length', str(len(payload)).encode()),
        ],
    })
    await send({'type': 'http.response.body', 'body': payload})


class BodySizeLimitMiddleware:
    """Bound every request body, before authentication and before the spool.

    Two layers, because either one alone is defeatable:

    1. A declared Content-Length over the ceiling is refused without reading a
       byte. Every browser, `axios` and `curl` sends one, so this is the path
       real traffic takes.
    2. A wrapped receive channel counts what actually arrives and stops at the
       same ceiling. This is what covers a chunked body with no Content-Length,
       and a Content-Length that lied.

    The second layer raises through the application rather than returning a
    status directly, because by then the handler owns the response. When the
    raise surfaces here with nothing sent yet, this sends 413. FastAPI wraps its
    own body read in `try/except Exception` and turns anything raised there into
    `400 There was an error parsing the body`, so a chunked overrun is reported
    as 400 rather than 413 -- the status is less precise, but the property that
    matters holds either way: the read stopped at the ceiling instead of running
    to the end of the caller's stream.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http' or scope.get('method', '') not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return

        limit = limit_for_path(scope.get('path', ''))
        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            logger.warning(
                'Refused a %d-byte body on %s before reading it (ceiling %d)',
                declared, scope.get('path', ''), limit,
            )
            await _send_too_large(send, limit)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message['type'] == 'http.request':
                received += len(message.get('body', b'') or b'')
                if received > limit:
                    logger.warning(
                        'Stopped an undeclared body on %s at the %d-byte ceiling',
                        scope.get('path', ''), limit,
                    )
                    raise BodyTooLarge()
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            if message['type'] == 'http.response.start':
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except BodyTooLarge:
            if not response_started:
                await _send_too_large(send, limit)
