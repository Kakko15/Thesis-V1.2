"""The API must keep serving other requests while a slow handler runs.

FastAPI runs an `async def` handler on the event loop itself, so any synchronous
call inside one stalls *every* other request for its full duration — /chat,
/health, and the readiness probe included. A 60-page novelty scan therefore made
the service look down to a load balancer and frozen to students.

Each test below proves two things about one handler:

  * every blocking call it makes runs off the main thread, checked by thread
    identity rather than by timing, so the assertion is exact; and
  * the event loop keeps getting control back while the handler is busy,
    measured as the largest gap between heartbeat ticks.

Measured on this platform, an idle loop awaiting 5 ms sleeps shows a maximum gap
of roughly 16 ms (the Windows timer granularity), and that figure is unchanged
when work is correctly offloaded. One 150 ms call left on the loop would show a
gap of at least 150 ms, so the 70 ms threshold sits with a wide margin on both
sides.
"""

import ast
import asyncio
import inspect
import pathlib
import threading
import time
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, Request, UploadFile
from starlette.datastructures import Headers

from models import ChatRequest
from routers import chat, duplication, upload
from services.document_processor import ExtractedDocument, ExtractedPage


class _NoRequestHeaders:
    """_chat_impl only reads headers off the request object."""

    headers: dict = {}

# One deliberately slow call per handler, standing in for the real remote work.
SLOW_CALL_SECONDS = 0.15
# Above the ~16 ms platform timer granularity, well below SLOW_CALL_SECONDS.
MAX_ACCEPTABLE_LOOP_GAP = 0.07
HEARTBEAT_INTERVAL = 0.005


class LoopMonitor:
    """Ticks on the event loop so stalls become measurable."""

    def __init__(self):
        self.ticks: list[float] = []
        self.end: float | None = None
        self._running = True

    async def run(self):
        while self._running:
            self.ticks.append(time.perf_counter())
            await asyncio.sleep(HEARTBEAT_INTERVAL)

    def stop(self):
        self._running = False
        self.end = time.perf_counter()

    @property
    def max_gap(self) -> float:
        """Longest stretch with no tick, including the tail after the last one.

        The tail matters: a fully blocked loop never ticks a second time, so
        measuring only the intervals *between* recorded ticks reports 0.0 for
        the very worst case. TestTheProbeItselfDetectsAStall pins this down.
        """
        if not self.ticks:
            return float('inf')
        closing = self.end if self.end is not None else self.ticks[-1]
        boundaries = [*self.ticks, closing]
        return max(later - earlier for earlier, later in zip(boundaries, boundaries[1:]))


class ThreadSpy:
    """Records which thread each stubbed blocking call ran on."""

    def __init__(self):
        self.calls: list[tuple[str, bool]] = []

    def blocking(self, label, result=None, *, sleep=0.0):
        def stub(*_args, **_kwargs):
            self.calls.append((label, threading.current_thread() is threading.main_thread()))
            if sleep:
                time.sleep(sleep)
            return result
        return stub

    def awaitable(self, label, result=None, *, sleep=0.0):
        """A native-async stub. It stays on the main thread by design and must
        yield control there rather than occupy a worker thread."""
        async def stub(*_args, **_kwargs):
            self.calls.append((label, threading.current_thread() is threading.main_thread()))
            if sleep:
                await asyncio.sleep(sleep)
            return result
        return stub

    @property
    def labels(self) -> list[str]:
        return [label for label, _main in self.calls]

    @property
    def ran_on_main_thread(self) -> list[str]:
        return [label for label, main in self.calls if main]


async def observe(coroutine):
    """Run one handler while a heartbeat measures event-loop responsiveness."""
    monitor = LoopMonitor()
    heartbeat = asyncio.create_task(monitor.run())
    await asyncio.sleep(0)  # let the heartbeat tick once before the work starts
    try:
        result = await coroutine
    finally:
        monitor.stop()
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass
    return result, monitor


class RecordingQuery:
    def __init__(self, spy, label, data):
        self._spy = spy
        self._label = label
        self._data = data

    def select(self, *_args): return self

    def insert(self, payload):
        # Echo the row back the way PostgREST does. The scan endpoint now
        # refuses to serve an id-less result (finding 17), so a stub that
        # returns nothing here would exercise the failure path instead of the
        # off-the-event-loop behaviour these tests are about.
        self._data = [{**payload, 'id': 'scan-1'}]
        return self

    def in_(self, *_args): return self
    def eq(self, *_args): return self
    def limit(self, *_args): return self
    def order(self, *_args, **_kwargs): return self

    def execute(self):
        self._spy.calls.append(
            (self._label, threading.current_thread() is threading.main_thread()),
        )
        return SimpleNamespace(data=self._data)


class RecordingBucket:
    def __init__(self, spy):
        self._spy = spy

    def upload(self, *_args, **_kwargs):
        self._spy.calls.append(
            ('storage.upload', threading.current_thread() is threading.main_thread()),
        )
        time.sleep(SLOW_CALL_SECONDS)

    def remove(self, *_args, **_kwargs):
        self._spy.calls.append(
            ('storage.remove', threading.current_thread() is threading.main_thread()),
        )


class RecordingClient:
    """Supabase stand-in that records the thread of every round trip."""

    def __init__(self, spy, *, rpc_results=None, table_results=None, slow_rpc=None):
        self._spy = spy
        self._rpc_results = rpc_results or {}
        self._table_results = table_results or {}
        self._slow_rpc = slow_rpc
        self.storage = SimpleNamespace(from_=lambda _bucket: RecordingBucket(spy))

    def rpc(self, name, _payload=None):
        self._spy.calls.append(
            (f'rpc:{name}', threading.current_thread() is threading.main_thread()),
        )
        if name == self._slow_rpc:
            time.sleep(SLOW_CALL_SECONDS)
        return SimpleNamespace(
            execute=lambda: SimpleNamespace(data=self._rpc_results.get(name)),
        )

    def table(self, name):
        return RecordingQuery(self._spy, f'table:{name}', self._table_results.get(name, []))


def scan_request():
    return Request({
        'type': 'http', 'method': 'POST', 'path': '/duplication/scan',
        'headers': [], 'query_string': b'', 'client': ('127.0.0.1', 1234),
        'server': ('test', 80), 'scheme': 'http',
    })


def text_upload():
    return UploadFile(
        BytesIO(b'A proposed study of campus attendance monitoring.'),
        filename='draft.txt',
        headers=Headers({'content-type': 'text/plain'}),
    )


def pdf_upload():
    return UploadFile(
        BytesIO(b'%PDF-1.7 minimal fixture'),
        filename='paper.pdf',
        headers=Headers({'content-type': 'application/pdf'}),
    )


class TestNoveltyScanKeepsTheLoopFree:
    def test_every_blocking_step_of_a_scan_runs_off_the_event_loop(self, monkeypatch):
        spy = ThreadSpy()
        document = ExtractedDocument([ExtractedPage(1, 'Clean proposed research content')])
        monkeypatch.setattr(
            duplication, 'resolve_effective_department',
            spy.blocking('resolve_effective_department', 'CCSICT'),
        )
        monkeypatch.setattr(
            duplication, 'extract_document', spy.blocking('extract_document', document),
        )
        monkeypatch.setattr(duplication, 'split_document', spy.blocking('split_document', [{
            'content': 'Clean proposed research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': 'Introduction',
        }]))
        monkeypatch.setattr(duplication, 'is_noise_chunk', lambda *_args: False)
        monkeypatch.setattr(duplication, 'validate_chunk_records', lambda records: records)
        # Stands in for the remote embedding batch, the dominant cost in practice.
        monkeypatch.setattr(
            duplication, 'embed_texts',
            spy.blocking('embed_texts', [[0.1] * 768], sleep=SLOW_CALL_SECONDS),
        )
        monkeypatch.setattr(duplication, 'log_activity', spy.blocking('log_activity'))
        monkeypatch.setattr(duplication, 'sb', RecordingClient(
            spy,
            rpc_results={'match_chunks': []},
            table_results={'scan_history': []},
        ))

        response, monitor = asyncio.run(observe(
            inspect.unwrap(duplication.scan_duplication)(
                scan_request(), text_upload(),
                user=SimpleNamespace(id='u1'), department=None,
            ),
        ))

        assert response['verdict_level'] == 'clear'
        assert spy.ran_on_main_thread == []
        # The per-chunk vector search must be offloaded too, not just embedding.
        assert 'rpc:match_chunks' in spy.labels
        assert 'table:scan_history' in spy.labels
        assert monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP, (
            f'the event loop stalled for {monitor.max_gap:.3f}s during a novelty scan'
        )
        assert len(monitor.ticks) >= 3, 'the loop never regained control'

    def test_the_verdict_model_call_yields_instead_of_holding_a_thread(self, monkeypatch):
        spy = ThreadSpy()
        document = ExtractedDocument([ExtractedPage(1, 'Clean proposed research content')])
        monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_args: 'CCSICT')
        monkeypatch.setattr(duplication, 'extract_document', lambda *_args: document)
        monkeypatch.setattr(duplication, 'split_document', lambda *_args: [{
            'content': 'Clean proposed research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': 'Introduction',
        }])
        monkeypatch.setattr(duplication, 'is_noise_chunk', lambda *_args: False)
        monkeypatch.setattr(duplication, 'validate_chunk_records', lambda records: records)
        monkeypatch.setattr(duplication, 'embed_texts', lambda *_args: [[0.1] * 768])
        monkeypatch.setattr(duplication, 'log_activity', lambda *_args, **_kwargs: None)
        monkeypatch.setattr(duplication, 'sb', RecordingClient(
            spy,
            rpc_results={'match_chunks': [{
                'paper_id': 'p1', 'content': 'Archived content', 'similarity': 0.9,
                'page_start': 2, 'page_end': 2, 'section': 'Introduction',
            }]},
            table_results={
                'papers': [{
                    'id': 'p1', 'title': 'Existing', 'authors': 'A', 'year': 2025,
                    'track': 'Data Mining', 'department': 'CCSICT',
                }],
                'scan_history': [],
            },
        ))
        monkeypatch.setattr(duplication, 'llm', SimpleNamespace(
            ainvoke=spy.awaitable(
                'llm.ainvoke',
                SimpleNamespace(content='Faculty review advised.'),
                sleep=SLOW_CALL_SECONDS,
            ),
        ))

        response, monitor = asyncio.run(observe(
            inspect.unwrap(duplication.scan_duplication)(
                scan_request(), text_upload(),
                user=SimpleNamespace(id='u1'), department=None,
            ),
        ))

        assert response['verdict_summary'] == 'Faculty review advised.'
        # Awaited natively, so it correctly stays on the loop's own thread...
        assert ('llm.ainvoke', True) in spy.calls
        # ...and yields while it waits.
        assert monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP, (
            f'the event loop stalled for {monitor.max_gap:.3f}s during verdict generation'
        )
        assert len(monitor.ticks) >= 3, 'the loop never regained control'


class TestUploadKeepsTheLoopFree:
    def test_every_blocking_step_of_a_submission_runs_off_the_event_loop(self, monkeypatch):
        spy = ThreadSpy()
        owner = '11111111-1111-4111-8111-111111111111'
        job_id = '22222222-2222-4222-8222-222222222222'
        monkeypatch.setattr(
            upload, 'resolve_effective_department',
            spy.blocking('resolve_effective_department', 'CCSICT'),
        )
        monkeypatch.setattr(
            upload, 'resolve_academic_selection',
            spy.blocking('resolve_academic_selection', SimpleNamespace(as_payload=lambda: {
                'department_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                'program_id': None, 'specialization_id': None,
                'track': '', 'legacy_track': None,
                'classification_status': 'unclassified',
            })),
        )
        monkeypatch.setattr(
            upload, '_validate_pdf_upload', spy.blocking('_validate_pdf_upload', 'paper.pdf'),
        )
        monkeypatch.setattr(
            upload, '_content_digest', spy.blocking('_content_digest', 'a' * 64),
        )
        monkeypatch.setattr(upload, 'sb', RecordingClient(spy, rpc_results={
            'reserve_upload_job': [{
                'job_id': job_id, 'job_status': 'staging',
                'stored_source_path': f'uploads/{owner}/{job_id}/paper.pdf',
                'created': True,
            }],
            'queue_upload_job': True,
        }))

        response, monitor = asyncio.run(observe(
            inspect.unwrap(upload.upload_paper)(
                request=SimpleNamespace(), file=pdf_upload(), title='Durable Thesis Library',
                authors='', year='', abstract='', track='', department='CCSICT',
                idempotency_key=None, user=SimpleNamespace(id=owner),
            ),
        ))

        assert response.status == 'queued'
        assert spy.ran_on_main_thread == []
        # The 25 MB private-storage upload is the slow step here.
        assert 'storage.upload' in spy.labels
        assert 'rpc:reserve_upload_job' in spy.labels
        assert 'rpc:queue_upload_job' in spy.labels
        assert monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP, (
            f'the event loop stalled for {monitor.max_gap:.3f}s during an upload'
        )
        assert len(monitor.ticks) >= 3, 'the loop never regained control'

    def test_metadata_extraction_runs_off_the_event_loop(self, monkeypatch):
        spy = ThreadSpy()
        monkeypatch.setattr(
            upload, '_validate_pdf_upload', spy.blocking('_validate_pdf_upload', 'paper.pdf'),
        )
        monkeypatch.setattr(
            upload, '_title_page_texts',
            spy.blocking('_title_page_texts', ['A Study of Campus Attendance'], sleep=0.02),
        )
        monkeypatch.setattr(upload, 'sb', RecordingClient(
            spy, table_results={'departments': [{'name': 'CCSICT'}]},
        ))
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', lambda **_kwargs: SimpleNamespace(
            ainvoke=spy.awaitable(
                'llm.ainvoke',
                SimpleNamespace(content='{"title": "A Study of Campus Attendance", '
                                        '"authors": "A. Researcher", "year": "", '
                                        '"department": "CCSICT"}'),
                sleep=SLOW_CALL_SECONDS,
            ),
        ))

        response, monitor = asyncio.run(observe(
            inspect.unwrap(upload.extract_metadata)(
                request=SimpleNamespace(), file=pdf_upload(), user=SimpleNamespace(id='u1'),
            ),
        ))

        assert response['title'] == 'A Study of Campus Attendance'
        assert spy.ran_on_main_thread == ['llm.ainvoke']  # native async, by design
        assert '_title_page_texts' in spy.labels
        assert 'table:departments' in spy.labels
        assert monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP, (
            f'the event loop stalled for {monitor.max_gap:.3f}s during metadata extraction'
        )
        assert len(monitor.ticks) >= 3, 'the loop never regained control'


class TestChatKeepsTheLoopFree:
    def test_department_resolution_is_offloaded_on_the_hottest_path(self, monkeypatch):
        # resolve_effective_department reads the caller's profile, and for a
        # superadmin the department list too. It ran directly on the loop in both
        # chat() and _chat_impl() — two synchronous round trips on every single
        # chat request, immediately beside correctly offloaded calls.
        spy = ThreadSpy()
        monkeypatch.setattr(
            chat, 'resolve_effective_department',
            spy.blocking('resolve_effective_department', 'CCSICT', sleep=SLOW_CALL_SECONDS),
        )

        response, monitor = asyncio.run(observe(chat._chat_impl(
            ChatRequest(question='Hello'), _NoRequestHeaders(), BackgroundTasks(), None,
        )))

        assert 'IskAI' in response.answer
        assert spy.labels == ['resolve_effective_department']
        assert spy.ran_on_main_thread == []
        assert monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP, (
            f'the event loop stalled for {monitor.max_gap:.3f}s resolving the department'
        )
        assert len(monitor.ticks) >= 3, 'the loop never regained control'


class TestNoBlockingCallCreepsBackIn:
    """Structural guard over the whole defect class, not just today's handlers.

    Timing tests only cover the paths they exercise. This walks every async
    function in routers/, services/, and main.py and fails if a known-blocking
    helper is called outside an await, so a new handler cannot reintroduce B1.
    Arguments to BackgroundTasks.add_task are excluded: FastAPI runs a
    synchronous background task in a worker thread after the response is sent.
    """

    BLOCKING_CALLS = (
        'sb.rpc', 'sb.table', 'sb.storage', 'sb.auth', 'client.rpc', 'client.table',
        'fitz.open', 'embed_text', 'embed_texts', 'llm.invoke', 'requests.',
        'httpx.post', 'httpx.get', 'time.sleep', 'extract_document', 'extract_text',
        'split_document', 'log_activity', 'resolve_effective_department',
        'get_user_scope', 'resolve_academic_selection', 'check_topic_duplication',
        'search_chunks', 'screen_new_submission', 'find_papers_by',
        'get_paper_overview_context', 'record_security_event', 'record_storage_cleanup',
        'validate_chunk_records', 'is_noise_chunk', 'hashlib.sha256',
        '_validate_pdf_upload', '_title_page_texts', '_content_digest',
        '_durable_job_status', '_remove_staged_source', '_fail_staging_job',
        '_load_chat_history', '_ensure_session_owner', '_persist_chat_exchange',
    )

    def _audited_files(self):
        backend = pathlib.Path(__file__).resolve().parent.parent
        return [
            *sorted((backend / 'routers').glob('*.py')),
            backend / 'main.py',
            *sorted((backend / 'services').glob('*.py')),
        ]

    def _offenders(self, path):
        text = path.read_text(encoding='utf-8')
        tree = ast.parse(text)
        found = []
        for func in [n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)]:
            exempt = set()
            for node in ast.walk(func):
                if isinstance(node, ast.Await):
                    exempt.update(id(inner) for inner in ast.walk(node))
                if isinstance(node, ast.Call) and 'add_task' in (
                    ast.get_source_segment(text, node) or ''
                )[:40]:
                    exempt.update(id(inner) for inner in ast.walk(node))
            for node in ast.walk(func):
                if not isinstance(node, ast.Call) or id(node) in exempt:
                    continue
                snippet = (ast.get_source_segment(text, node) or '').split('\n')[0]
                if any(call in snippet for call in self.BLOCKING_CALLS):
                    found.append(f'{path.name}::{func.name} line {node.lineno}: {snippet.strip()}')
        return found

    def test_no_async_function_blocks_the_event_loop(self):
        offenders = [item for path in self._audited_files() for item in self._offenders(path)]
        assert offenders == [], (
            'these synchronous calls run on the event loop; wrap them in '
            'asyncio.to_thread or await an async equivalent:\n  '
            + '\n  '.join(offenders)
        )

    def test_the_audit_actually_inspects_the_async_handlers(self):
        # A silently empty sweep would pass the test above for the wrong reason.
        counted = sum(
            1
            for path in self._audited_files()
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8')))
            if isinstance(node, ast.AsyncFunctionDef)
        )
        assert counted >= 15, f'only {counted} async functions were audited'

    def test_the_audit_would_catch_a_reintroduced_blocking_call(self, tmp_path):
        regressed = tmp_path / 'regressed.py'
        regressed.write_text(
            'async def handler(user):\n'
            '    department = resolve_effective_department(user, None)\n'
            '    return sb.table("papers").select("id").execute()\n',
            encoding='utf-8',
        )
        offenders = self._offenders(regressed)
        assert any('resolve_effective_department' in item for item in offenders)
        assert any('sb.table' in item for item in offenders)


class TestTheProbeItselfDetectsAStall:
    """Guards the two tests above: a genuinely blocking call must fail them."""

    def test_a_synchronous_call_on_the_loop_is_detected(self):
        async def blocking_handler():
            time.sleep(SLOW_CALL_SECONDS)  # exactly what B1 was
            return 'done'

        result, monitor = asyncio.run(observe(blocking_handler()))

        assert result == 'done'
        assert monitor.max_gap >= SLOW_CALL_SECONDS, (
            'the probe failed to notice a blocked event loop'
        )
        assert not monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP

    def test_the_same_call_offloaded_passes(self):
        async def offloaded_handler():
            await asyncio.to_thread(time.sleep, SLOW_CALL_SECONDS)
            return 'done'

        _result, monitor = asyncio.run(observe(offloaded_handler()))

        assert monitor.max_gap < MAX_ACCEPTABLE_LOOP_GAP


@pytest.mark.parametrize('handler', [
    duplication.scan_duplication,
    upload.upload_paper,
    upload.extract_metadata,
])
def test_the_repaired_handlers_are_still_coroutines(handler):
    """The fix offloads the blocking calls; it must not silently make these
    handlers synchronous, which would move them into the shared thread pool and
    change their concurrency contract."""
    assert inspect.iscoroutinefunction(inspect.unwrap(handler))
