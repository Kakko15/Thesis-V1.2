"""The body ceiling that refuses an oversized upload before anything reads it.

FastAPI parses the request body BEFORE it resolves dependencies, and Starlette
spools every file part past the first megabyte to disk, so authentication
cannot be what stops an oversized manuscript: by the time `require_upload_access`
runs, the bytes are already written. This middleware is what stops it, and these
tests pin the two layers it uses -- the declared Content-Length, and the receive
channel for a body that declares nothing.
"""

import asyncio

from config import settings
from services import request_limits
from services.request_limits import BodySizeLimitMiddleware, limit_for_path


class Downstream:
    """Stands in for the application, recording what it managed to read."""

    def __init__(self):
        self.called = False
        self.received = 0

    async def __call__(self, scope, receive, send):
        self.called = True
        while True:
            message = await receive()
            if message['type'] != 'http.request':
                break
            self.received += len(message.get('body', b''))
            if not message.get('more_body'):
                break
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'ok'})


def scope(path='/upload/paper', method='POST', content_length=None):
    headers = []
    if content_length is not None:
        headers.append((b'content-length', str(content_length).encode()))
    return {'type': 'http', 'method': method, 'path': path, 'headers': headers}


def run(app, request_scope, chunks=()):
    sent = []
    queue = list(chunks)

    async def receive():
        return queue.pop(0) if queue else {'type': 'http.disconnect'}

    async def send(message):
        sent.append(message)

    asyncio.run(app(request_scope, receive, send))
    return sent


def status_of(sent):
    return next(
        message['status'] for message in sent if message['type'] == 'http.response.start'
    )


def tiny_ceiling(monkeypatch, limit=8):
    """Shrink the ceiling to a handful of bytes so the tests stay fast."""
    monkeypatch.setattr(settings, 'max_upload_mb', 0)
    monkeypatch.setattr(request_limits, '_SINGLE_SLACK_BYTES', limit)
    return limit


class TestTheDeclaredLength:
    def test_a_body_over_the_ceiling_is_refused_without_being_read(self, monkeypatch):
        tiny_ceiling(monkeypatch)
        app = Downstream()
        sent = run(BodySizeLimitMiddleware(app), scope(content_length=4096))
        assert status_of(sent) == 413
        # The point of the whole middleware: the application never ran, so
        # nothing was parsed, nothing was spooled, and no dependency resolved.
        assert app.called is False

    def test_a_body_within_the_ceiling_reaches_the_application(self, monkeypatch):
        tiny_ceiling(monkeypatch)
        app = Downstream()
        sent = run(
            BodySizeLimitMiddleware(app), scope(content_length=4),
            [{'type': 'http.request', 'body': b'abcd', 'more_body': False}],
        )
        assert status_of(sent) == 200
        assert (app.called, app.received) == (True, 4)

    def test_an_unparseable_length_falls_through_to_the_streaming_guard(self, monkeypatch):
        tiny_ceiling(monkeypatch)
        app = Downstream()
        sent = run(
            BodySizeLimitMiddleware(app), scope(content_length='not-a-number'),
            [{'type': 'http.request', 'body': b'abcd', 'more_body': False}],
        )
        assert status_of(sent) == 200


class TestTheStreamingGuard:
    def test_an_undeclared_body_is_stopped_at_the_ceiling(self, monkeypatch):
        limit = tiny_ceiling(monkeypatch)
        app = Downstream()
        sent = run(
            BodySizeLimitMiddleware(app), scope(),
            [
                {'type': 'http.request', 'body': b'aaaa', 'more_body': True},
                {'type': 'http.request', 'body': b'bbbb', 'more_body': True},
                {'type': 'http.request', 'body': b'cccc', 'more_body': True},
                {'type': 'http.request', 'body': b'dddd', 'more_body': False},
            ],
        )
        assert status_of(sent) == 413
        # A chunked caller declaring nothing still cannot stream past the
        # ceiling: the read stops there rather than running to the end.
        assert app.received <= limit


class TestWhatIsLeftAlone:
    def test_a_get_is_never_intercepted(self, monkeypatch):
        tiny_ceiling(monkeypatch)
        app = Downstream()
        sent = run(
            BodySizeLimitMiddleware(app),
            scope(method='GET', content_length=4096),
            [{'type': 'http.request', 'body': b'', 'more_body': False}],
        )
        assert status_of(sent) == 200

    def test_a_non_http_scope_passes_straight_through(self):
        app = Downstream()
        sent = run(
            BodySizeLimitMiddleware(app),
            {'type': 'lifespan', 'method': 'POST', 'path': '/', 'headers': []},
            [{'type': 'http.request', 'body': b'', 'more_body': False}],
        )
        assert status_of(sent) == 200


class TestTheCeilingItself:
    def test_a_batch_may_carry_a_whole_shelf_and_a_single_upload_may_not(self):
        single = limit_for_path('/upload/paper')
        batch = limit_for_path('/upload/batch')
        assert batch > single
        # Room for every file the batch endpoint accepts, and for one
        # manuscript everywhere else, with slack for multipart overhead.
        megabyte = 1024 * 1024
        assert single > settings.max_upload_mb * megabyte
        assert batch > settings.max_batch_files * settings.max_upload_mb * megabyte

    def test_the_extraction_endpoints_are_bounded_too(self):
        # Every route that reads an UploadFile is covered, not just the two
        # that stage one: extraction spools exactly the same bytes.
        for path in ('/upload/extract-metadata', '/duplication/scan'):
            assert limit_for_path(path) == limit_for_path('/upload/paper')
        assert limit_for_path('/upload/batch/extract-metadata') == limit_for_path('/upload/batch')
