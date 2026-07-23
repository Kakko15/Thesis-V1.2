"""Durable queue, worker retry, and idempotent ingestion contracts."""

import asyncio
import hashlib
import inspect
from io import BytesIO
from types import SimpleNamespace

import fitz
import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

from routers import upload
from services import ingestion, upload_queue
from services.document_processor import ExtractedDocument, ExtractedPage
from workers import ingestion_worker


JOB_ID = '11111111-1111-4111-8111-111111111111'
OWNER_ID = '22222222-2222-4222-8222-222222222222'
IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333'


def pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), 'A sufficiently detailed thesis methodology paragraph for indexing.')
    content = document.tobytes()
    document.close()
    return content


class Result:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error

    def execute(self):
        if self.error:
            raise self.error
        return SimpleNamespace(data=self.data)


class RpcClient:
    def __init__(self, responses=None, bucket=None):
        self.responses = responses or {}
        self.calls = []
        self.storage = Storage(bucket or Bucket())

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        response = self.responses.get(name)
        if isinstance(response, BaseException):
            return Result(error=response)
        return Result(response)


class Bucket:
    def __init__(self, content=b'', fail_upload=False, fail_remove=False):
        self.content = content
        self.fail_upload = fail_upload
        self.fail_remove = fail_remove
        self.uploaded = []
        self.removed = []

    def upload(self, path, content, file_options=None):
        if self.fail_upload:
            raise RuntimeError('storage unavailable')
        self.content = bytes(content)
        self.uploaded.append((path, file_options))

    def download(self, _path):
        return self.content

    def remove(self, paths):
        if self.fail_remove:
            raise RuntimeError('storage unavailable')
        self.removed.extend(paths)


class Storage:
    def __init__(self, bucket):
        self.bucket = bucket

    def from_(self, _name):
        return self.bucket


class Query:
    def __init__(self, data=None):
        self.data = data
        self.updates = []

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def single(self): return self
    def limit(self, *_args): return self
    def update(self, payload):
        self.updates.append(payload)
        return self
    def insert(self, _payload): return self
    def execute(self): return SimpleNamespace(data=self.data)


class PipelineClient:
    def __init__(self, content: bytes, *, commit_error=None, recovered=False):
        self.storage = Storage(Bucket(content))
        self.rpc_calls = []
        self.commit_error = commit_error
        self.recovered = recovered

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        if name == 'commit_upload_ingestion':
            return Result(JOB_ID, self.commit_error)
        return Result(True)

    def table(self, name):
        if self.recovered and name == 'upload_jobs':
            return Query({'status': 'completed', 'paper_id': JOB_ID, 'chunks': 1})
        if self.recovered and name == 'papers':
            return Query({'id': JOB_ID, 'ingestion_status': 'ready', 'chunk_count': 1})
        return Query(None)


def claimed_job(content: bytes) -> dict:
    return {
        'id': JOB_ID,
        'owner_id': OWNER_ID,
        'department': 'CCSICT',
        'source_path': f'uploads/{OWNER_ID}/{JOB_ID}/paper.pdf',
        'original_filename': 'paper.pdf',
        'content_sha256': hashlib.sha256(content).hexdigest(),
        'attempt_count': 1,
        'max_attempts': 3,
        'request_payload': {
            'title': 'Durable Thesis Library', 'authors': 'A. Researcher',
            'year': '2026', 'abstract': '', 'track': 'Data Mining',
            'department': 'CCSICT', 'uploader_id': OWNER_ID,
        },
    }


def patch_pipeline(monkeypatch):
    document = ExtractedDocument(
        [ExtractedPage(1, 'A sufficiently detailed thesis methodology paragraph for indexing.')],
        {'email': 1},
    )
    monkeypatch.setattr(ingestion, 'extract_document', lambda *_args: document)
    monkeypatch.setattr(ingestion, 'split_document', lambda *_args: [{
        'content': 'A sufficiently detailed thesis methodology paragraph for indexing.',
        'chunk_index': 0, 'page_start': 1, 'page_end': 1,
        'section': 'Methodology', 'token_count': 12,
        'tokenizer': 'cl100k_base', 'chunking_version': 'token-v1',
    }])
    monkeypatch.setattr(ingestion, 'is_noise_chunk', lambda *_args: False)
    monkeypatch.setattr(ingestion, 'embed_texts', lambda *_args: [[0.1] * 768])
    monkeypatch.setattr(ingestion, 'screen_new_submission', lambda *_args: {'flagged': False})
    monkeypatch.setattr(ingestion, 'log_activity', lambda *_args, **_kwargs: None)


class TestPipeline:
    def test_verified_pipeline_uses_atomic_job_completion(self, monkeypatch):
        content = pdf_bytes()
        client = PipelineClient(content)
        patch_pipeline(monkeypatch)
        paper_id = ingestion.process_ingestion_job(client, claimed_job(content), 'worker-1', lambda **_kw: True)
        assert paper_id == JOB_ID
        name, payload = client.rpc_calls[-1]
        assert name == 'commit_upload_ingestion'
        assert payload['p_job_id'] == JOB_ID
        assert payload['p_paper']['storage_path'].endswith('/paper.pdf')
        assert payload['p_paper']['redaction_stats'] == {'email': 1}
        assert len(payload['p_chunks'][0]['embedding']) == 768

    def test_changed_staged_file_is_permanent_failure(self):
        content = pdf_bytes()
        client = PipelineClient(content + b'changed')
        with pytest.raises(ingestion.PermanentIngestionError, match='hash'):
            ingestion.process_ingestion_job(client, claimed_job(content), 'worker-1', lambda **_kw: True)

    def test_lost_lease_stops_before_side_effects(self):
        content = pdf_bytes()
        client = PipelineClient(content)
        with pytest.raises(ingestion.LeaseLostError):
            ingestion.process_ingestion_job(client, claimed_job(content), 'worker-1', lambda **_kw: False)
        assert client.rpc_calls == []

    def test_ambiguous_commit_recovers_deterministic_result(self, monkeypatch):
        content = pdf_bytes()
        client = PipelineClient(content, commit_error=TimeoutError('response lost'), recovered=True)
        patch_pipeline(monkeypatch)
        assert ingestion.process_ingestion_job(
            client, claimed_job(content), 'worker-1', lambda **_kw: True,
        ) == JOB_ID


class TestRetryPolicy:
    @pytest.mark.parametrize('error', [
        TimeoutError('timed out'),
        RuntimeError('HTTP 429 rate limit'),
        RuntimeError('503 service unavailable'),
    ])
    def test_transient_failures_retry(self, error):
        assert upload_queue.is_retryable_ingestion_error(error)

    @pytest.mark.parametrize('error', [
        ingestion.PermanentIngestionError('bad PDF'),
        ingestion.LeaseLostError('lost'),
        ValueError('invalid dimensions'),
    ])
    def test_permanent_failures_do_not_retry(self, error):
        assert not upload_queue.is_retryable_ingestion_error(error)

    def test_retry_after_is_bounded(self):
        retry = upload_queue.retry_at(RuntimeError('Retry-After: 9999'), 1)
        seconds = (retry - upload_queue.datetime.now(upload_queue.timezone.utc)).total_seconds()
        assert 895 <= seconds <= 901

    def test_worker_schedules_retry_but_never_fails_same_attempt(self, monkeypatch):
        calls = []
        monkeypatch.setattr(ingestion_worker, 'LeaseHeartbeat', _NoopHeartbeat)
        monkeypatch.setattr(
            ingestion_worker, 'process_ingestion_job',
            lambda *_args: (_ for _ in ()).throw(TimeoutError('timed out')),
        )
        monkeypatch.setattr(ingestion_worker, 'schedule_retry', lambda *_args: calls.append('retry') or True)
        monkeypatch.setattr(ingestion_worker, 'fail_job', lambda *_args: calls.append('fail') or True)
        ingestion_worker.process_claimed_job(object(), claimed_job(pdf_bytes()), 'worker-1')
        assert calls == ['retry']

    def test_exhausted_worker_records_permanent_failure(self, monkeypatch):
        calls = []
        job = claimed_job(pdf_bytes())
        job['attempt_count'] = job['max_attempts']
        monkeypatch.setattr(ingestion_worker, 'LeaseHeartbeat', _NoopHeartbeat)
        monkeypatch.setattr(
            ingestion_worker, 'process_ingestion_job',
            lambda *_args: (_ for _ in ()).throw(TimeoutError('timed out')),
        )
        monkeypatch.setattr(ingestion_worker, 'schedule_retry', lambda *_args: calls.append('retry'))
        monkeypatch.setattr(ingestion_worker, 'fail_job', lambda *_args: calls.append('fail') or True)
        ingestion_worker.process_claimed_job(object(), job, 'worker-1')
        assert calls == ['fail']

    def test_queue_helpers_preserve_worker_lease_contract(self):
        client = RpcClient({
            'claim_upload_job': [{'id': JOB_ID, 'lease_owner': 'worker-1'}],
            'heartbeat_upload_job': True,
            'schedule_upload_retry': True,
            'fail_upload_job': True,
            'expire_upload_jobs': 4,
        })
        assert upload_queue.claim_job(client, 'worker-1', 120)['id'] == JOB_ID
        assert upload_queue.heartbeat_job(
            client, JOB_ID, 'worker-1', 120,
            stage='embed', progress=58, message='Embedding safely',
        )
        assert upload_queue.schedule_retry(
            client, {**claimed_job(pdf_bytes()), 'attempt_count': 2},
            'worker-1', TimeoutError('timed out'),
        )
        assert upload_queue.fail_job(
            client, JOB_ID, 'worker-1', RuntimeError('secret provider response'),
        )
        assert upload_queue.expire_terminal_jobs(client) == 4
        failed_payload = next(payload for name, payload in client.calls if name == 'fail_upload_job')
        assert 'secret provider response' not in failed_payload['p_public_error']
        assert failed_payload['p_failure_category'] == 'RuntimeError'

    def test_heartbeat_marks_lease_invalid_after_authoritative_rejection(self, monkeypatch):
        monkeypatch.setattr(
            ingestion_worker, 'heartbeat_job_control',
            lambda *_args, **_kwargs: {'lease_valid': False, 'cancel_requested': False},
        )
        heartbeat = ingestion_worker.LeaseHeartbeat(object(), JOB_ID, 'worker-1')
        assert heartbeat.update(stage='extract') is False
        assert heartbeat.valid is False

    def test_one_shot_worker_returns_without_waiting_when_queue_is_empty(self, monkeypatch):
        calls = []
        monkeypatch.setattr(ingestion_worker, 'process_one_cleanup', lambda *_args: calls.append('cleanup'))
        monkeypatch.setattr(ingestion_worker, 'expire_terminal_jobs', lambda *_args: calls.append('expire'))
        monkeypatch.setattr(ingestion_worker, 'claim_job', lambda *_args: None)
        assert ingestion_worker.run_worker(once=True, client=object()) == 0
        assert calls == ['cleanup', 'expire']


class TestCleanupRecovery:
    def test_failed_source_cleanup_can_be_delegated_safely(self, monkeypatch):
        bucket = Bucket(fail_remove=True)
        client = RpcClient({
            'claim_upload_cleanup': [{
                'id': JOB_ID, 'source_path': 'uploads/owner/job/paper.pdf',
            }],
            'finish_upload_cleanup': True,
        }, bucket=bucket)
        monkeypatch.setattr(upload_queue, 'record_storage_cleanup', lambda *_args, **_kwargs: True)
        assert upload_queue.process_one_cleanup(client, 'worker-1') is True
        finish = next(payload for name, payload in client.calls if name == 'finish_upload_cleanup')
        assert finish['p_delegated'] is True

    def test_unpersisted_cleanup_remains_claimable(self, monkeypatch):
        client = RpcClient({
            'claim_upload_cleanup': [{
                'id': JOB_ID, 'source_path': 'uploads/owner/job/paper.pdf',
            }],
        }, bucket=Bucket(fail_remove=True))
        monkeypatch.setattr(upload_queue, 'record_storage_cleanup', lambda *_args, **_kwargs: False)
        assert upload_queue.process_one_cleanup(client, 'worker-1') is False
        assert all(name != 'finish_upload_cleanup' for name, _payload in client.calls)

    def test_successful_cleanup_confirms_storage_disposition(self):
        bucket = Bucket()
        client = RpcClient({
            'claim_upload_cleanup': [{
                'id': JOB_ID, 'source_path': 'uploads/owner/job/paper.pdf',
            }],
            'finish_upload_cleanup': True,
        }, bucket=bucket)
        assert upload_queue.process_one_cleanup(client, 'worker-1') is True
        assert bucket.removed == ['uploads/owner/job/paper.pdf']
        finish = next(payload for name, payload in client.calls if name == 'finish_upload_cleanup')
        assert finish['p_delegated'] is False


class _NoopHeartbeat:
    def __init__(self, *_args): pass
    def __enter__(self): return lambda **_kwargs: True
    def __exit__(self, *_args): return None


class UploadClient:
    def __init__(self, *, reserve_status='staging', created=True, fail_upload=False,
                 fail_remove=False, queue_error=None, reserve_error=None,
                 current_status=None):
        self.bucket = Bucket(fail_upload=fail_upload, fail_remove=fail_remove)
        self.storage = Storage(self.bucket)
        self.reserve_status = reserve_status
        self.created = created
        self.queue_error = queue_error
        self.reserve_error = reserve_error
        self.current_status = current_status or reserve_status
        self.queries = {}

    def rpc(self, name, payload):
        if name == 'reserve_upload_job':
            if self.reserve_error:
                return Result(error=self.reserve_error)
            return Result([{
                'job_id': JOB_ID,
                'job_status': self.reserve_status,
                'stored_source_path': f'uploads/{OWNER_ID}/{JOB_ID}/paper.pdf',
                'stored_content_sha256': payload['p_content_sha256'],
                'created': self.created,
            }])
        if name == 'queue_upload_job':
            return Result(True, self.queue_error)
        raise AssertionError(name)

    def table(self, name):
        return self.queries.setdefault(name, Query([{'status': self.current_status}]))


def upload_file() -> UploadFile:
    return UploadFile(
        BytesIO(pdf_bytes()),
        filename='paper.pdf',
        headers=Headers({'content-type': 'application/pdf'}),
    )


class TestUploadApi:
    def test_submission_is_staged_with_idempotency_key(self, monkeypatch):
        client = UploadClient()
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        endpoint = inspect.unwrap(upload.upload_paper)
        response = asyncio.run(endpoint(
            request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
            authors='A. Researcher', year='2026', abstract='', track='', department='CCSICT',
            idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID),
        ))
        assert response.job_id == JOB_ID
        assert response.idempotency_key == IDEMPOTENCY_KEY
        assert response.status == 'queued'
        assert len(client.bucket.uploaded) == 1

    def test_duplicate_completed_submission_does_not_upload_again(self, monkeypatch):
        client = UploadClient(reserve_status='completed', created=False)
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        endpoint = inspect.unwrap(upload.upload_paper)
        response = asyncio.run(endpoint(
            request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
            authors='', year='', abstract='', track='', department='CCSICT',
            idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID),
        ))
        assert response.status == 'completed'
        assert client.bucket.uploaded == []

    def test_invalid_idempotency_key_is_rejected(self, monkeypatch):
        monkeypatch.setattr(upload, 'sb', UploadClient())
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        endpoint = inspect.unwrap(upload.upload_paper)
        with pytest.raises(HTTPException) as caught:
            asyncio.run(endpoint(
                request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
                authors='', year='', abstract='', track='', department='CCSICT',
                idempotency_key='not-a-uuid', user=SimpleNamespace(id=OWNER_ID),
            ))
        assert caught.value.status_code == 400

    def test_reused_key_with_different_hash_is_a_conflict(self, monkeypatch):
        client = UploadClient(reserve_error=RuntimeError(
            'Idempotency key was already used for different content'
        ))
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        endpoint = inspect.unwrap(upload.upload_paper)
        with pytest.raises(HTTPException) as caught:
            asyncio.run(endpoint(
                request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
                authors='', year='', abstract='', track='', department='CCSICT',
                idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID),
            ))
        assert caught.value.status_code == 409

    def test_ambiguous_queue_response_keeps_committed_source(self, monkeypatch):
        client = UploadClient(queue_error=TimeoutError('response lost'), current_status='queued')
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        endpoint = inspect.unwrap(upload.upload_paper)
        response = asyncio.run(endpoint(
            request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
            authors='', year='', abstract='', track='', department='CCSICT',
            idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID),
        ))
        assert response.status == 'queued'
        assert client.bucket.removed == []

    def test_staging_failure_compensates_private_source(self, monkeypatch):
        client = UploadClient(fail_upload=True)
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        endpoint = inspect.unwrap(upload.upload_paper)
        with pytest.raises(HTTPException) as caught:
            asyncio.run(endpoint(
                request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
                authors='', year='', abstract='', track='', department='CCSICT',
                idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID),
            ))
        assert caught.value.status_code == 503
        assert client.bucket.removed

    def test_failed_compensation_persists_cleanup_on_job(self, monkeypatch):
        client = UploadClient(fail_upload=True, fail_remove=True)
        cleanup_calls = []
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)
        monkeypatch.setattr(
            upload, 'record_storage_cleanup',
            lambda *_args, **kwargs: cleanup_calls.append(kwargs) or False,
        )
        endpoint = inspect.unwrap(upload.upload_paper)
        with pytest.raises(HTTPException):
            asyncio.run(endpoint(
                request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
                authors='', year='', abstract='', track='', department='CCSICT',
                idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID),
            ))
        updates = client.queries['upload_jobs'].updates
        assert updates[-1]['cleanup_status'] == 'pending'
        assert updates[-1]['source_stored'] is True
        assert cleanup_calls[0]['job_id'] == JOB_ID


class TestSqlQueueContracts:
    @pytest.mark.parametrize('path', [
        'supabase_setup.sql',
        'migrations/20260723_durable_ingestion_jobs.sql',
    ])
    def test_queue_contract_is_atomic_leased_and_service_role_only(self, path):
        sql = open(path, encoding='utf-8').read().lower()
        assert 'for update skip locked' in sql
        assert 'function public.reserve_upload_job' in sql
        assert 'function public.claim_upload_job' in sql
        assert 'function public.heartbeat_upload_job' in sql
        assert 'function public.commit_upload_ingestion' in sql
        assert 'public.commit_paper_ingestion(p_paper, p_chunks)' in sql
        assert 'upload_jobs_owner_idempotency_uidx' in sql
        assert 'revoke all on function public.claim_upload_job' in sql
        assert 'grant execute on function public.claim_upload_job' in sql
        assert "status in ('staging', 'queued', 'processing', 'retry_wait', 'completed', 'failed')" in sql
        assert "cleanup_status in ('not_required', 'completed')" in sql
        assert "cleanup_status in ('not_required', 'completed', 'delegated')" not in sql
