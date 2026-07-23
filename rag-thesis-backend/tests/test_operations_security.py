"""Operations, cancellation, malware, retention, and privacy controls."""

import hashlib
import hmac
import inspect
import json
import logging
import os
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from cryptography.exceptions import InvalidTag
from pydantic import ValidationError

from config import Settings
from scripts import storage_backup
from services import malware, operations, upload_queue
from services.safe_logging import PrivacyFilter, redact_log_text
from workers import ingestion_worker
from models import UploadCancelRequest
from routers import maintenance, upload
import main


class Result:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return SimpleNamespace(data=self.data)


class RpcClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def rpc(self, name, payload):
        self.calls.append((name, payload))
        return Result(self.responses.get(name))


def test_operations_migration_is_additive_private_and_cancellation_safe():
    sql = Path('migrations/20260724_operations_security.sql').read_text(encoding='utf-8').lower()
    for value in (
        'upload_job_events', 'ingestion_workers', 'operational_alerts',
        'security_audit_events', "'cancelled'", 'request_upload_cancellation',
        'for update skip locked', 'cancel_requested_at is null',
        'upsert_operational_alert', 'apply_operations_retention',
    ):
        assert value in sql
    assert 'revoke all on table public.upload_job_events' in sql
    assert 'grant select on table public.upload_job_events' in sql
    assert 'grant all on table public.upload_job_events' not in sql
    assert 'revoke all on function public.request_upload_cancellation' in sql
    assert 'grant execute on function public.request_upload_cancellation' in sql
    assert "status in ('completed', 'failed', 'cancelled')" in sql
    assert "interval '30 days'" in sql
    assert "interval '90 days'" in sql
    assert "interval '1 year'" in sql
    assert 'foreign key (job_id) references public.upload_jobs(id) on delete set null' in sql
    assert sql.strip().startswith('-- operations') and '\nbegin;' in sql
    assert sql.strip().endswith('commit;')
    assert "when public.operational_alerts.status = 'resolved' then 'open'" in sql


def test_control_heartbeat_reports_cooperative_cancellation():
    client = RpcClient({'heartbeat_upload_job_control': {
        'lease_valid': True, 'cancel_requested': True,
    }})
    result = upload_queue.heartbeat_job_control(
        client, 'job-id', 'worker-1', 120, stage='embed', progress=55,
    )
    assert result == {'lease_valid': True, 'cancel_requested': True}


def test_finalize_cancellation_uses_lease_owner():
    client = RpcClient({'finalize_upload_cancellation': True})
    assert upload_queue.finalize_cancellation(client, 'job-id', 'worker-1') is True
    assert client.calls == [('finalize_upload_cancellation', {
        'p_job_id': 'job-id', 'p_worker_id': 'worker-1',
    })]


@pytest.mark.parametrize(('result', 'error'), [
    ('stream: OK', None),
    ('stream: Eicar-Signature FOUND', malware.MalwareDetected),
    ('stream: UNKNOWN', malware.MalwareScannerUnavailable),
])
def test_malware_scan_outcomes(monkeypatch, result, error):
    monkeypatch.setattr(malware.settings, 'malware_scan_mode', 'clamav')
    monkeypatch.setattr(malware, '_command', lambda *_args: result)
    if error:
        with pytest.raises(error):
            malware.scan_pdf(b'%PDF-safe-test')
    else:
        malware.scan_pdf(b'%PDF-safe-test')


def test_disabled_scanner_skips_local_development(monkeypatch):
    monkeypatch.setattr(malware.settings, 'malware_scan_mode', 'disabled')
    monkeypatch.setattr(malware, '_command', lambda *_args: pytest.fail('scanner called'))
    malware.scan_pdf(b'%PDF-local')
    assert malware.scanner_status() == 'disabled'


def test_production_fails_closed_without_clamav():
    with pytest.raises(ValidationError, match='ClamAV'):
        Settings(
            gemini_api_key='test', supabase_url='https://example.supabase.co',
            supabase_key='test', app_environment='production',
            rate_limit_storage_uri='redis://redis:6379/0', require_privileged_mfa=True,
            malware_scan_mode='disabled',
        )


def test_webhook_signing_secret_requires_cryptographic_length():
    with pytest.raises(ValidationError, match='at least 32'):
        Settings(
            gemini_api_key='test', supabase_url='https://example.supabase.co',
            supabase_key='test', operations_alert_webhook_url='https://alerts.example.test',
            operations_alert_webhook_secret='too-short',
        )


def test_webhook_is_signed_and_retries_transient_failure(monkeypatch):
    calls = []
    monkeypatch.setattr(operations.settings, 'operations_alert_webhook_url', 'https://alerts.example.test/hook')
    monkeypatch.setattr(operations.settings, 'operations_alert_webhook_secret', 'signing-secret')
    monkeypatch.setattr(operations.settings, 'operations_alert_timeout_seconds', 2.0)
    monkeypatch.setattr(operations.time, 'sleep', lambda _seconds: None)

    class Response:
        status_code = 200
        def raise_for_status(self): return None

    def post(_url, *, content, headers, timeout):
        calls.append((content, headers, timeout))
        if len(calls) == 1:
            raise httpx.TimeoutException('temporary')
        return Response()

    monkeypatch.setattr(operations.httpx, 'post', post)
    client = SimpleNamespace(table=lambda _name: Query())
    alert = {
        'id': 'alert-id', 'alert_type': 'queue_age', 'severity': 'warning',
        'status': 'open', 'last_seen_at': '2026-07-24T00:00:00+00:00',
        'safe_details': {'stale_jobs': 2},
    }
    assert operations.notify_webhook(client, alert) is True
    assert len(calls) == 2
    body, headers, _timeout = calls[-1]
    expected = hmac.new(b'signing-secret', body, hashlib.sha256).hexdigest()
    assert headers['X-ISU-Signature'] == f'sha256={expected}'
    assert b'filename' not in body and b'content' not in body


class Query:
    def __init__(self, data=None):
        self.data = data or [{'id': 'alert-id'}]
        self.updates = []
    def update(self, value): self.updates.append(value); return self
    def eq(self, *_args): return self
    def neq(self, *_args): return self
    def execute(self): return SimpleNamespace(data=self.data)


def test_alert_upsert_prefers_atomic_rpc():
    client = RpcClient({'upsert_operational_alert': [{'id': 'one', 'occurrence_count': 2}]})
    alert = operations.upsert_alert(client, 'queue', 'queue_depth', 'warning', {'queued_jobs': 12})
    assert alert['occurrence_count'] == 2
    assert client.calls[0][0] == 'upsert_operational_alert'


def test_retention_dry_run_never_changes_apply_flag():
    client = RpcClient({'apply_operations_retention': [{'applied': False, 'upload_jobs': 3}]})
    assert operations.retention_report(client, apply=False)['applied'] is False
    assert client.calls[0][1] == {'p_apply': False}


@pytest.mark.parametrize('value', [
    'Authorization: Bearer secret-token',
    'https://service.test/path?apikey=secret&file=paper.pdf',
    'password=super-secret',
])
def test_privacy_logging_redacts_sensitive_values(value):
    redacted = redact_log_text(value)
    assert 'secret-token' not in redacted
    assert 'paper.pdf' not in redacted
    assert 'super-secret' not in redacted


def test_privacy_filter_discards_unsafe_format_arguments():
    record = logging.LogRecord('test', logging.INFO, '', 1, 'token=%s', ('secret',), None)
    assert PrivacyFilter().filter(record)
    assert record.args == ()
    assert 'secret' not in record.getMessage()


def test_storage_encryption_round_trip_and_wrong_passphrase(tmp_path):
    source = tmp_path / 'source.tar.gz'
    encrypted = tmp_path / 'storage.isubackup'
    restored = tmp_path / 'restored.tar.gz'
    source.write_bytes(os.urandom(2 * 1024 * 1024 + 9))
    storage_backup._encrypt(source, encrypted, 'correct horse battery staple')
    storage_backup._decrypt(encrypted, restored, 'correct horse battery staple')
    assert restored.read_bytes() == source.read_bytes()
    with pytest.raises(InvalidTag):
        storage_backup._decrypt(encrypted, tmp_path / 'wrong', 'incorrect passphrase')


def test_storage_restore_rejects_production_before_client_creation(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_backup, 'create_client', lambda *_args: pytest.fail('client created'))
    with pytest.raises(ValueError, match='local'):
        storage_backup.restore(SimpleNamespace(
            url='https://production.supabase.co', key='secret', input=str(tmp_path / 'none'),
        ))


@pytest.mark.parametrize('object_path', ['../escape.pdf', '/absolute.pdf', 'safe/../../escape.pdf'])
def test_storage_object_paths_cannot_escape_backup_root(tmp_path, object_path):
    with pytest.raises(ValueError, match='unsafe|escaped'):
        storage_backup._object_file(tmp_path, 'pdfs', object_path)


def test_storage_manifest_rejects_duplicate_and_malformed_objects(tmp_path):
    root = tmp_path / 'backup'
    object_path = root / 'objects' / 'pdfs' / 'paper.pdf'
    object_path.parent.mkdir(parents=True)
    object_path.write_bytes(b'%PDF-test')
    digest = hashlib.sha256(object_path.read_bytes()).hexdigest()
    item = {'bucket': 'pdfs', 'path': 'paper.pdf', 'sha256': digest}
    (root / 'manifest.json').write_text(
        json.dumps({'format': 1, 'objects': [item, item]}), encoding='utf-8',
    )
    with pytest.raises(ValueError, match='duplicate'):
        storage_backup._verify_tree(root)

    (root / 'manifest.json').write_text(
        json.dumps({'format': 1, 'objects': [{'bucket': 'pdfs', 'path': None}]}),
        encoding='utf-8',
    )
    with pytest.raises(ValueError, match='unsafe'):
        storage_backup._verify_tree(root)


@pytest.mark.skipif(os.getenv('RUN_CLAMAV_INTEGRATION') != '1', reason='ClamAV Docker integration is opt-in')
def test_clamav_eicar_integration(monkeypatch):
    monkeypatch.setattr(malware.settings, 'malware_scan_mode', 'clamav')
    eicar = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    assert malware.scanner_status() == 'healthy'
    with pytest.raises(malware.MalwareDetected):
        malware.scan_pdf(eicar)


def test_portable_frontend_headers_are_explicit():
    config = Path('../rag-thesis-frontend/nginx/default.conf.template').read_text(encoding='utf-8')
    for header in (
        'Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options',
        'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security',
    ):
        assert f'add_header {header}' in config
    assert '${API_ORIGIN}' in config and '${SUPABASE_ORIGIN}' in config
    static_location = config.split('location ~*', 1)[1]
    assert 'add_header Cache-Control' not in static_location


def test_backup_wrapper_loads_backend_environment_without_secret_prompt():
    script = Path('scripts/backup_system.ps1').read_text(encoding='utf-8')
    assert "Get-DotEnvValue -Path $EnvFile -Name 'SUPABASE_URL'" in script
    assert "Get-DotEnvValue -Path $EnvFile -Name 'SUPABASE_KEY'" in script
    assert "Read-Host 'Supabase service-role key'" not in script
    assert "Get-Date -Format 'yyyy-MM-dd-HHmmss'" in script
    assert "Remove-Item Env:SUPABASE_BACKUP_KEY" in script


class FluentQuery:
    def __init__(self, data=None):
        self.data = data or []
        self.inserts = []
        self.updates = []
    def select(self, *_args): return self
    def eq(self, *_args): return self
    def neq(self, *_args): return self
    def gte(self, *_args): return self
    def in_(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self
    def insert(self, value): self.inserts.append(value); return self
    def update(self, value): self.updates.append(value); return self
    def execute(self): return SimpleNamespace(data=self.data)


class TableClient:
    def __init__(self, tables=None, rpc=None):
        self.tables = {name: FluentQuery(rows) for name, rows in (tables or {}).items()}
        self.rpc_responses = rpc or {}
    def table(self, name): return self.tables.setdefault(name, FluentQuery())
    def rpc(self, name, _payload): return Result(self.rpc_responses.get(name))


def test_operations_evaluation_resolves_inactive_alerts(monkeypatch):
    client = TableClient({
        'ingestion_workers': [{
            'worker_id': 'worker', 'state': 'idle', 'scanner_status': 'healthy',
            'last_seen_at': '9999-12-31T00:00:00+00:00',
        }],
        'upload_jobs': [],
    })
    resolved = []
    monkeypatch.setattr(operations, 'resolve_alert', lambda _client, key: resolved.append(key))
    result = operations.evaluate_operations(client)
    assert result['status'] == 'healthy'
    assert result['healthy_workers'] == 1
    assert set(resolved) == {
        'worker_unavailable', 'queue_depth', 'queue_age', 'cleanup_delayed',
        'retries_exhausted', 'scanner_unavailable',
    }


def test_unavailable_scanner_is_not_counted_as_a_healthy_worker(monkeypatch):
    client = TableClient({
        'ingestion_workers': [{
            'worker_id': 'worker', 'state': 'degraded', 'scanner_status': 'unavailable',
            'last_seen_at': '9999-12-31T00:00:00+00:00',
        }],
        'upload_jobs': [],
    })
    monkeypatch.setattr(operations, 'upsert_alert', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(operations, 'resolve_alert', lambda *_args: None)
    result = operations.evaluate_operations(client)
    assert result['healthy_workers'] == 0
    assert result['scanner_unavailable'] == 1
    assert result['status'] == 'degraded'


def test_unknown_scanner_state_fails_closed(monkeypatch):
    client = TableClient({
        'ingestion_workers': [{
            'worker_id': 'legacy', 'state': 'idle', 'scanner_status': None,
            'last_seen_at': '9999-12-31T00:00:00Z',
        }],
        'upload_jobs': [],
    })
    monkeypatch.setattr(operations, 'upsert_alert', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(operations, 'resolve_alert', lambda *_args: None)
    result = operations.evaluate_operations(client)
    assert result['healthy_workers'] == 0
    assert result['scanner_unavailable'] == 1
    assert result['status'] == 'degraded'


def test_future_retry_wait_is_not_reported_as_queued_or_stale(monkeypatch):
    client = TableClient({
        'ingestion_workers': [{
            'worker_id': 'worker', 'state': 'idle', 'scanner_status': 'healthy',
            'last_seen_at': '9999-12-31T00:00:00+00:00',
        }],
        'upload_jobs': [{
            'id': 'retry', 'status': 'retry_wait',
            'created_at': '2000-01-01T00:00:00+00:00',
            'updated_at': '2000-01-01T00:00:00+00:00',
            'next_retry_at': '9999-12-31T00:00:00+00:00',
            'cleanup_status': 'not_required', 'attempt_count': 1, 'max_attempts': 3,
        }],
    })
    monkeypatch.setattr(operations, 'resolve_alert', lambda *_args: None)
    result = operations.evaluate_operations(client)
    assert result['queued_jobs'] == 0
    assert result['stale_jobs'] == 0


def test_operations_evaluation_deduplicates_all_active_conditions(monkeypatch):
    jobs = [
        {
            'id': str(index), 'status': 'queued', 'created_at': '2000-01-01T00:00:00+00:00',
            'updated_at': '2000-01-01T00:00:00+00:00', 'cleanup_status': 'pending',
            'attempt_count': 3, 'max_attempts': 3,
        } for index in range(12)
    ]
    jobs.append({
        'id': 'failed', 'status': 'failed', 'created_at': '2000-01-01T00:00:00+00:00',
        'updated_at': '2000-01-01T00:00:00+00:00', 'cleanup_status': 'completed',
        'attempt_count': 3, 'max_attempts': 3,
    })
    client = TableClient({'ingestion_workers': [], 'upload_jobs': jobs})
    created, notified = [], []
    monkeypatch.setattr(
        operations, 'upsert_alert',
        lambda _client, key, kind, severity, details: created.append((key, kind, severity, details)) or {
            'id': key, 'last_notified_at': None,
        },
    )
    monkeypatch.setattr(operations, 'notify_webhook', lambda _client, alert: notified.append(alert['id']))
    result = operations.evaluate_operations(client)
    assert result['status'] == 'degraded'
    assert {'worker_unavailable', 'queue_depth', 'queue_age', 'cleanup_delayed', 'retries_exhausted'} <= {
        item[0] for item in created
    }
    assert set(notified) == {item[0] for item in created}


def test_cancelled_job_with_delayed_cleanup_triggers_alert(monkeypatch):
    client = TableClient({
        'ingestion_workers': [{
            'worker_id': 'worker', 'state': 'idle', 'scanner_status': 'healthy',
            'last_seen_at': '9999-12-31T00:00:00+00:00',
        }],
        'upload_jobs': [{
            'id': 'cancelled', 'status': 'cancelled',
            'created_at': '2000-01-01T00:00:00+00:00',
            'updated_at': '2000-01-01T00:00:00+00:00',
            'cleanup_status': 'pending', 'attempt_count': 1, 'max_attempts': 3,
        }],
    })
    created = []
    monkeypatch.setattr(
        operations, 'upsert_alert',
        lambda _client, key, *_args: created.append(key) or {'id': key},
    )
    monkeypatch.setattr(operations, 'notify_webhook', lambda *_args: True)
    monkeypatch.setattr(operations, 'resolve_alert', lambda *_args: None)
    result = operations.evaluate_operations(client)
    assert result['pending_cleanups'] == 1
    assert 'cleanup_delayed' in created


def test_worker_registration_and_security_event_helpers():
    client = TableClient(
        {'security_audit_events': []},
        {'register_ingestion_worker': True, 'stop_ingestion_worker': True},
    )
    assert operations.register_worker(client, 'worker', state='idle', scanner='healthy')
    assert operations.stop_worker(client, 'worker')
    operations.record_security_event(
        client, 'test_event', actor_id='actor', department='CCSICT', details={'safe': True},
    )
    inserted = client.tables['security_audit_events'].inserts[0]
    assert inserted['safe_details'] == {'safe': True}


def test_scanner_socket_protocol_and_outages(monkeypatch):
    class Socket:
        def __init__(self, response): self.response = response; self.sent = []
        def __enter__(self): return self
        def __exit__(self, *_args): return None
        def settimeout(self, _value): return None
        def sendall(self, value): self.sent.append(bytes(value))
        def recv(self, _size): return self.response

    connection = Socket(b'stream: OK\0')
    monkeypatch.setattr(malware.socket, 'create_connection', lambda *_args, **_kwargs: connection)
    assert malware._command(b'zINSTREAM\0', b'payload') == 'stream: OK'
    assert connection.sent[0] == b'zINSTREAM\0'
    assert connection.sent[-1] == b'\0\0\0\0'
    monkeypatch.setattr(
        malware.socket, 'create_connection',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError('offline')),
    )
    with pytest.raises(malware.MalwareScannerUnavailable):
        malware._command(b'zPING\0')


def test_worker_refuses_claim_when_scanner_is_unavailable(monkeypatch):
    calls = []
    monkeypatch.setattr(ingestion_worker, 'scanner_status', lambda: 'unavailable')
    monkeypatch.setattr(ingestion_worker, 'register_worker', lambda *_args, **_kwargs: calls.append('register'))
    monkeypatch.setattr(ingestion_worker, 'process_one_cleanup', lambda *_args: calls.append('cleanup'))
    monkeypatch.setattr(ingestion_worker, 'expire_terminal_jobs', lambda *_args: calls.append('expire'))
    monkeypatch.setattr(ingestion_worker, 'claim_job', lambda *_args: pytest.fail('job claimed'))
    monkeypatch.setattr(ingestion_worker, 'stop_worker', lambda *_args: calls.append('stop'))
    assert ingestion_worker.run_worker(once=True, client=object()) == 0
    assert calls == ['register', 'cleanup', 'expire', 'stop']


def test_worker_claims_and_processes_one_job(monkeypatch):
    jobs = iter([{'id': 'job-id'}, None])
    calls = []
    monkeypatch.setattr(ingestion_worker, 'scanner_status', lambda: 'healthy')
    monkeypatch.setattr(ingestion_worker, 'register_worker', lambda *_args, **_kwargs: calls.append('registry'))
    monkeypatch.setattr(ingestion_worker, 'process_one_cleanup', lambda *_args: None)
    monkeypatch.setattr(ingestion_worker, 'expire_terminal_jobs', lambda *_args: None)
    monkeypatch.setattr(ingestion_worker, 'claim_job', lambda *_args: next(jobs))
    monkeypatch.setattr(ingestion_worker, 'process_claimed_job', lambda *_args: calls.append('processed'))
    monkeypatch.setattr(ingestion_worker, 'stop_worker', lambda *_args: calls.append('stopped'))
    assert ingestion_worker.run_worker(once=True, client=object()) == 1
    assert 'processed' in calls and calls[-1] == 'stopped'


def test_processing_lease_heartbeat_refreshes_worker_registry(monkeypatch):
    heartbeat = ingestion_worker.LeaseHeartbeat(
        object(), 'job-id', 'worker-id', scanner='healthy',
    )
    waits = iter([False, True])
    heartbeat._stop = SimpleNamespace(wait=lambda _seconds: next(waits))
    monkeypatch.setattr(heartbeat, 'update', lambda: True)
    calls = []
    monkeypatch.setattr(
        ingestion_worker, 'register_worker',
        lambda *_args, **kwargs: calls.append(kwargs),
    )
    heartbeat._run('healthy')
    assert calls == [{
        'state': 'processing', 'scanner': 'healthy', 'current_job_id': 'job-id',
    }]


def test_processing_cancellation_finalizes_without_failure(monkeypatch):
    finalized, failed = [], []

    class Heartbeat:
        def __init__(self, *_args): pass
        def __enter__(self): return lambda **_kwargs: True
        def __exit__(self, *_args): return None

    monkeypatch.setattr(ingestion_worker, 'LeaseHeartbeat', Heartbeat)
    monkeypatch.setattr(
        ingestion_worker, 'process_ingestion_job',
        lambda *_args: (_ for _ in ()).throw(ingestion_worker.CancellationRequested()),
    )
    monkeypatch.setattr(
        ingestion_worker, 'finalize_cancellation',
        lambda *_args: finalized.append(True) or True,
    )
    monkeypatch.setattr(ingestion_worker, 'fail_job', lambda *_args: failed.append(True))
    ingestion_worker.process_claimed_job(object(), {'id': 'job-id'}, 'worker')
    assert finalized == [True] and failed == []


def test_upload_status_exposes_cancellation_lifecycle(monkeypatch):
    client = TableClient({
        'upload_jobs': [{
            'id': 'job-id', 'owner_id': 'owner', 'department': 'CCSICT',
            'status': 'processing', 'stage': 'embed', 'progress': 55,
            'message': 'Working', 'attempt_count': 1, 'max_attempts': 3,
            'cancel_requested_at': '2026-07-24T00:00:00Z', 'cancelled_at': None,
        }],
        'upload_job_events': [{'created_at': '2026-07-24T00:00:01Z'}],
    })
    monkeypatch.setattr(upload, 'sb', client)
    result = upload.upload_status('job-id', user=SimpleNamespace(id='owner'))
    assert result.cancel_requested is True
    assert result.can_cancel is False
    assert result.last_event_at == '2026-07-24T00:00:01Z'


def test_owner_cancellation_returns_sanitized_result(monkeypatch):
    client = TableClient(
        {'profiles': [{'role': 'admin', 'department': 'CCSICT'}], 'security_audit_events': []},
        {'request_upload_cancellation': {
            'outcome': 'cancellation_requested', 'status': 'processing',
            'cancel_requested': True, 'cancelled_at': None,
        }},
    )
    monkeypatch.setattr(upload, 'sb', client)
    endpoint = inspect.unwrap(upload.cancel_upload_job)
    result = endpoint(
        request=SimpleNamespace(), job_id='job-id',
        payload=UploadCancelRequest(reason='No longer needed'),
        user=SimpleNamespace(id='owner'),
    )
    assert result.cancel_requested is True
    assert result.status == 'processing'
    assert client.tables['security_audit_events'].inserts[0]['event_type'] == 'upload_cancellation'


def test_cancellation_forbidden_and_not_found(monkeypatch):
    endpoint = inspect.unwrap(upload.cancel_upload_job)
    for outcome, status in [('forbidden', 403), ('not_found', 404)]:
        client = TableClient(
            {'profiles': [{'role': 'admin'}]},
            {'request_upload_cancellation': {'outcome': outcome, 'status': 'unknown'}},
        )
        monkeypatch.setattr(upload, 'sb', client)
        with pytest.raises(Exception) as caught:
            endpoint(
                request=SimpleNamespace(), job_id='job-id', payload=UploadCancelRequest(),
                user=SimpleNamespace(id='owner'),
            )
        assert caught.value.status_code == status


def test_superadmin_operations_routes(monkeypatch):
    client = TableClient({
        'ingestion_workers': [{
            'worker_id': 'secret-worker-name', 'state': 'idle', 'scanner_status': 'healthy',
            'last_seen_at': '2026-07-24T00:00:00Z',
        }],
        'upload_jobs': [{'id': 'job', 'status': 'queued'}],
        'operational_alerts': [{'id': 'alert', 'status': 'open'}],
        'security_audit_events': [],
    })
    monkeypatch.setattr(maintenance, 'sb', client)
    monkeypatch.setattr(maintenance, 'evaluate_operations', lambda _client: {'status': 'healthy'})
    monkeypatch.setattr(maintenance, 'retention_report', lambda _client, apply=False: {'applied': apply})
    user = SimpleNamespace(id='superadmin')
    assert maintenance.operations_summary(user=user) == {'status': 'healthy'}
    worker = maintenance.list_workers(user=user)['workers'][0]
    assert worker['worker_id'] != 'secret-worker-name' and len(worker['worker_id']) == 12
    assert maintenance.list_upload_jobs(user=user)['jobs'][0]['id'] == 'job'
    assert maintenance.list_operational_alerts(user=user)['alerts'][0]['id'] == 'alert'
    assert maintenance.get_retention_report(user=user) == {'applied': False}
    assert maintenance.run_retention(apply=False, user=user) == {'applied': False}


def test_alert_acknowledgement_and_retention_guard(monkeypatch):
    client = TableClient({
        'operational_alerts': [{'id': 'alert', 'status': 'acknowledged'}],
        'security_audit_events': [],
    })
    monkeypatch.setattr(maintenance, 'sb', client)
    user = SimpleNamespace(id='superadmin')
    assert maintenance.acknowledge_alert('alert', user=user)['status'] == 'acknowledged'
    monkeypatch.setattr(maintenance.settings, 'retention_enforcement_enabled', False)
    with pytest.raises(Exception) as caught:
        maintenance.run_retention(apply=True, user=user)
    assert caught.value.status_code == 409


def test_worker_health_is_generic(monkeypatch):
    healthy = TableClient({'ingestion_workers': [{
        'state': 'idle', 'scanner_status': 'healthy', 'last_seen_at': '9999-01-01T00:00:00Z',
    }]})
    monkeypatch.setattr('dependencies.auth.sb', healthy)
    response = main.worker_health()
    assert response.status_code == 200
    assert json.loads(response.body) == {'status': 'healthy'}
    monkeypatch.setattr('dependencies.auth.sb', TableClient({'ingestion_workers': []}))
    response = main.worker_health()
    assert response.status_code == 503
    assert 'worker' not in response.body.decode()


def test_api_operations_monitor_lifecycle(monkeypatch):
    monkeypatch.setattr(main.settings, 'operations_monitor_enabled', True)
    monkeypatch.setattr(main, '_operations_monitor', lambda: None)
    main._OPERATIONS_STATE['thread'] = None
    main.start_operations_monitor()
    assert main._OPERATIONS_STATE['thread'] is not None
    main.stop_operations_monitor()
    assert main._OPERATIONS_STATE['thread'] is None


def test_heartbeat_context_and_cancellation_branches(monkeypatch):
    heartbeat = ingestion_worker.LeaseHeartbeat(object(), 'job', 'worker')
    lifecycle = []
    heartbeat._thread = SimpleNamespace(
        start=lambda: lifecycle.append('start'), join=lambda timeout: lifecycle.append(timeout),
    )
    assert heartbeat.__enter__() == heartbeat.update
    heartbeat.__exit__(None, None, None)
    assert lifecycle[0] == 'start'

    heartbeat = ingestion_worker.LeaseHeartbeat(object(), 'job', 'worker')
    heartbeat.valid = False
    assert heartbeat.update() is False
    heartbeat.cancel_requested = True
    with pytest.raises(ingestion_worker.CancellationRequested):
        heartbeat.update()

    heartbeat = ingestion_worker.LeaseHeartbeat(object(), 'job', 'worker')
    monkeypatch.setattr(
        ingestion_worker, 'heartbeat_job_control',
        lambda *_args, **_kwargs: {'lease_valid': True, 'cancel_requested': True},
    )
    with pytest.raises(ingestion_worker.CancellationRequested):
        heartbeat.update(stage='extract')

    heartbeat = ingestion_worker.LeaseHeartbeat(object(), 'job', 'worker')
    monkeypatch.setattr(
        ingestion_worker, 'heartbeat_job_control',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('offline')),
    )
    assert heartbeat.update() is False


def test_heartbeat_background_loop_stops_on_rejection(monkeypatch):
    heartbeat = ingestion_worker.LeaseHeartbeat(object(), 'job', 'worker')
    waits = iter([False])
    heartbeat._stop = SimpleNamespace(wait=lambda _seconds: next(waits))
    monkeypatch.setattr(heartbeat, 'update', lambda: False)
    heartbeat._run('healthy')


def test_worker_lease_loss_and_malware_alert_paths(monkeypatch):
    class Heartbeat:
        def __init__(self, *_args): pass
        def __enter__(self): return lambda **_kwargs: True
        def __exit__(self, *_args): return None

    monkeypatch.setattr(ingestion_worker, 'LeaseHeartbeat', Heartbeat)
    monkeypatch.setattr(
        ingestion_worker, 'process_ingestion_job',
        lambda *_args: (_ for _ in ()).throw(ingestion_worker.LeaseLostError('lost')),
    )
    ingestion_worker.process_claimed_job(object(), {'id': 'job'}, 'worker')

    alerts, failures = [], []
    monkeypatch.setattr(
        ingestion_worker, 'process_ingestion_job',
        lambda *_args: (_ for _ in ()).throw(
            ingestion_worker.MalwareDetectedIngestionError('infected')
        ),
    )
    monkeypatch.setattr(
        ingestion_worker, 'upsert_alert',
        lambda *_args, **_kwargs: alerts.append('persisted') or {'id': 'alert'},
    )
    monkeypatch.setattr(ingestion_worker, 'notify_webhook', lambda *_args: alerts.append('notified'))
    monkeypatch.setattr(ingestion_worker, 'fail_job', lambda *_args: failures.append(True) or True)
    ingestion_worker.process_claimed_job(
        object(), {'id': 'job', 'attempt_count': 1, 'max_attempts': 3}, 'worker',
    )
    assert alerts == ['persisted', 'notified'] and failures == [True]


def test_operations_backward_compatibility_and_notify_timing(monkeypatch):
    class MissingRpcClient(TableClient):
        def rpc(self, _name, _payload):
            raise RuntimeError('PGRST202 could not find the function')

    existing = MissingRpcClient({'operational_alerts': [{
        'id': 'alert', 'occurrence_count': 1,
    }]})
    assert operations.upsert_alert(existing, 'key', 'queue', 'warning')['id'] == 'alert'
    created = MissingRpcClient({'operational_alerts': []})
    created.tables['operational_alerts'].data = [{'id': 'created'}]
    assert operations.upsert_alert(created, 'key', 'queue', 'warning')['id'] == 'created'
    assert operations.register_worker(created, 'worker', state='idle', scanner='healthy') is False
    assert operations.stop_worker(created, 'worker') is False

    monkeypatch.setattr(operations.settings, 'operations_alert_webhook_url', '')
    assert operations.notify_webhook(created, {}) is False
    assert operations._notify_due({'last_notified_at': 'not-a-date'}) is True
    assert operations._notify_due({'last_notified_at': None}) is True


def test_alert_fallback_preserves_acknowledgement_until_resolution():
    class MissingRpcClient(TableClient):
        def rpc(self, _name, _payload):
            raise RuntimeError('PGRST202 could not find the function')

    client = MissingRpcClient({'operational_alerts': [{
        'id': 'alert', 'status': 'acknowledged', 'occurrence_count': 4,
        'acknowledged_at': '2026-07-24T00:00:00+00:00',
        'acknowledged_by': 'admin',
    }]})
    operations.upsert_alert(client, 'queue', 'queue_depth', 'warning')
    update = client.tables['operational_alerts'].updates[-1]
    assert update['status'] == 'acknowledged'
    assert update['occurrence_count'] == 4
    assert update['acknowledged_by'] == 'admin'


def test_webhook_failure_is_bounded_and_persisted(monkeypatch):
    monkeypatch.setattr(operations.settings, 'operations_alert_webhook_url', 'https://alerts.example.test')
    monkeypatch.setattr(operations.settings, 'operations_alert_webhook_secret', 'secret')
    monkeypatch.setattr(operations.time, 'sleep', lambda _seconds: None)
    calls, degraded = [], []
    monkeypatch.setattr(
        operations.httpx, 'post',
        lambda *_args, **_kwargs: calls.append(True) or (_ for _ in ()).throw(
            httpx.TimeoutException('offline')
        ),
    )
    monkeypatch.setattr(
        operations, 'upsert_alert',
        lambda _client, key, *_args: degraded.append(key),
    )
    assert operations.notify_webhook(object(), {
        'id': 'alert', 'alert_type': 'queue', 'severity': 'warning',
    }) is False
    assert len(calls) == 3 and degraded == ['webhook_degraded']


def test_maintenance_routes_fail_closed(monkeypatch):
    user = SimpleNamespace(id='superadmin')
    monkeypatch.setattr(
        maintenance, 'evaluate_operations',
        lambda _client: (_ for _ in ()).throw(RuntimeError('offline')),
    )
    with pytest.raises(Exception) as caught:
        maintenance.operations_summary(user=user)
    assert caught.value.status_code == 503

    class BrokenClient:
        def table(self, _name): raise RuntimeError('offline')

    monkeypatch.setattr(maintenance, 'sb', BrokenClient())
    for call in (
        lambda: maintenance.list_workers(user=user),
        lambda: maintenance.list_upload_jobs(user=user),
        lambda: maintenance.list_operational_alerts(user=user),
    ):
        with pytest.raises(Exception) as caught:
            call()
        assert caught.value.status_code == 503

    monkeypatch.setattr(
        maintenance, 'retention_report',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('offline')),
    )
    for call in (
        lambda: maintenance.get_retention_report(user=user),
        lambda: maintenance.run_retention(apply=False, user=user),
    ):
        with pytest.raises(Exception) as caught:
            call()
        assert caught.value.status_code == 503


def test_acknowledging_missing_alert_returns_not_found(monkeypatch):
    monkeypatch.setattr(maintenance, 'sb', TableClient({'operational_alerts': []}))
    with pytest.raises(Exception) as caught:
        maintenance.acknowledge_alert('missing', user=SimpleNamespace(id='superadmin'))
    assert caught.value.status_code == 404


def test_operations_monitor_runs_one_bounded_evaluation(monkeypatch):
    states = iter([False, True])

    class Stop:
        def is_set(self): return next(states)
        def wait(self, _seconds): return None

    calls = []
    monkeypatch.setattr(main, '_operations_stop', Stop())
    monkeypatch.setattr(operations, 'evaluate_operations', lambda _client: calls.append(True))
    main._operations_monitor()
    assert calls == [True]


def test_worker_health_handles_registry_failure(monkeypatch):
    class BrokenClient:
        def table(self, _name): raise RuntimeError('offline')

    monkeypatch.setattr('dependencies.auth.sb', BrokenClient())
    response = main.worker_health()
    assert response.status_code == 503


def test_complete_encrypted_storage_backup_and_local_restore(monkeypatch, tmp_path):
    payloads = {'pdfs': b'%PDF-private', 'avatars': b'avatar-bytes'}
    uploads = []

    class Bucket:
        def __init__(self, name): self.name = name
        def list(self, _prefix, _options):
            return [{'id': f'{self.name}-id', 'name': 'private-object.bin'}]
        def download(self, _path): return payloads[self.name]
        def upload(self, path, value, _options): uploads.append((self.name, path, value))

    class Storage:
        def from_(self, name): return Bucket(name)

    monkeypatch.setattr(storage_backup, 'create_client', lambda *_args: SimpleNamespace(storage=Storage()))
    monkeypatch.setattr(storage_backup, '_passphrase', lambda confirm=False: 'correct horse battery staple')
    target = tmp_path / 'storage.isubackup'
    storage_backup.backup(SimpleNamespace(
        url='https://source.supabase.co', key='service-key', output=str(target),
    ))
    report_text = target.with_suffix('.isubackup.report.json').read_text(encoding='utf-8')
    assert 'private-object.bin' not in report_text
    assert json.loads(report_text)['object_count'] == 2
    storage_backup.verify(SimpleNamespace(input=str(target)))
    storage_backup.restore(SimpleNamespace(
        url='http://127.0.0.1:54321', key='local-key', input=str(target),
    ))
    assert len(uploads) == 2
    assert {value for _bucket, _path, value in uploads} == set(payloads.values())


def test_database_restore_script_has_local_guard_and_relationship_check():
    script = Path('scripts/restore_database_local.ps1').read_text(encoding='utf-8')
    assert 'disposable local PostgreSQL' in script
    assert "'localhost', '127.0.0.1', 'host.docker.internal'" in script
    assert 'orphan_chunks=' in script
