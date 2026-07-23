"""Opt-in RLS checks that may run only against a disposable Supabase project."""

import os
import hmac
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import pytest
import jwt
from dotenv import dotenv_values, load_dotenv
from postgrest.exceptions import APIError
from supabase import create_client

from config import settings

load_dotenv(override=False)


def _application_credentials() -> tuple[set[str], set[str]]:
    """Read both process and file configuration; tests must not mask production."""
    env_file = dotenv_values(os.path.join(os.path.dirname(__file__), '..', '.env'))
    urls = {
        value.strip().rstrip('/')
        for value in (settings.supabase_url, os.getenv('SUPABASE_URL'), env_file.get('SUPABASE_URL'))
        if value
    }
    keys = {
        value.strip()
        for value in (settings.supabase_key, os.getenv('SUPABASE_KEY'), env_file.get('SUPABASE_KEY'))
        if value
    }
    return urls, keys


def _disposable_config():
    if os.getenv('ALLOW_DISPOSABLE_SUPABASE_TESTS') != '1':
        pytest.skip('set ALLOW_DISPOSABLE_SUPABASE_TESTS=1 to authorize disposable-project writes')

    url = os.getenv('TEST_SUPABASE_URL', '').strip()
    anon_key = os.getenv('TEST_SUPABASE_ANON_KEY', '').strip()
    service_key = os.getenv('TEST_SUPABASE_SERVICE_ROLE_KEY', '').strip()
    expected_project_ref = os.getenv('TEST_SUPABASE_PROJECT_REF', '').strip()
    if not all((url, anon_key, service_key, expected_project_ref)):
        pytest.skip('disposable Supabase credentials are not configured')

    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    actual_project_ref = host.split('.')[0] if host.endswith('.supabase.co') else ''
    if parsed.scheme != 'https' or not actual_project_ref:
        pytest.fail('TEST_SUPABASE_URL must be an HTTPS Supabase project URL')
    if actual_project_ref != expected_project_ref:
        pytest.fail('TEST_SUPABASE_PROJECT_REF does not match TEST_SUPABASE_URL')
    application_urls, application_keys = _application_credentials()
    if url.rstrip('/') in application_urls:
        pytest.fail('TEST_SUPABASE_URL must not equal the configured application project')
    if any(hmac.compare_digest(service_key, key) for key in application_keys):
        pytest.fail('Disposable and application service-role keys must be different')
    if hmac.compare_digest(service_key, anon_key):
        pytest.fail('Disposable anon and service-role keys must be different')
    try:
        anon_claims = jwt.decode(anon_key, options={'verify_signature': False})
        service_claims = jwt.decode(service_key, options={'verify_signature': False})
    except jwt.InvalidTokenError as error:
        pytest.fail(f'Disposable project keys must be valid JWTs: {type(error).__name__}')
    if anon_claims.get('role') != 'anon' or service_claims.get('role') != 'service_role':
        pytest.fail('Disposable keys have the wrong Supabase roles')
    if anon_claims.get('ref') != actual_project_ref or service_claims.get('ref') != actual_project_ref:
        pytest.fail('Disposable keys do not belong to TEST_SUPABASE_URL')
    return url, anon_key, service_key


def test_disposable_guard_rejects_application_project(monkeypatch):
    project_ref = urlparse(settings.supabase_url).hostname.split('.')[0]
    monkeypatch.setenv('ALLOW_DISPOSABLE_SUPABASE_TESTS', '1')
    monkeypatch.setenv('TEST_SUPABASE_URL', settings.supabase_url)
    monkeypatch.setenv('TEST_SUPABASE_PROJECT_REF', project_ref)
    monkeypatch.setenv('TEST_SUPABASE_ANON_KEY', 'test-anon')
    monkeypatch.setenv('TEST_SUPABASE_SERVICE_ROLE_KEY', 'different-test-key')
    with pytest.raises(pytest.fail.Exception, match='must not equal'):
        _disposable_config()


def test_disposable_guard_rejects_application_service_key(monkeypatch):
    monkeypatch.setenv('ALLOW_DISPOSABLE_SUPABASE_TESTS', '1')
    monkeypatch.setenv('TEST_SUPABASE_URL', 'https://disposable-ref.supabase.co')
    monkeypatch.setenv('TEST_SUPABASE_PROJECT_REF', 'disposable-ref')
    monkeypatch.setenv('TEST_SUPABASE_ANON_KEY', 'test-anon')
    monkeypatch.setenv('TEST_SUPABASE_SERVICE_ROLE_KEY', settings.supabase_key)
    with pytest.raises(pytest.fail.Exception, match='service-role keys'):
        _disposable_config()


@pytest.mark.integration
def test_signup_role_escalation_and_profile_security_fields_are_blocked():
    url, anon_key, service_key = _disposable_config()
    service = create_client(url, service_key)
    ordinary = create_client(url, anon_key)
    user_id = None
    avatar_path = None
    pdf_path = None
    password = f'Test!{uuid.uuid4().hex}aA1'
    email = f'codex-rls-{uuid.uuid4().hex}@example.invalid'

    try:
        created = service.auth.admin.create_user({
            'email': email,
            'password': password,
            'email_confirm': True,
            'user_metadata': {
                'full_name': 'Disposable RLS Test',
                'requested_role': 'superadmin',
                'department': 'CCSICT',
            },
        })
        user_id = str(created.user.id)
        profile = (
            service.table('profiles').select('role,status,department')
            .eq('id', user_id).single().execute().data
        )
        assert profile == {'role': 'student', 'status': 'approved', 'department': 'CCSICT'}

        ordinary.auth.sign_in_with_password({'email': email, 'password': password})
        ordinary.table('profiles').update({'full_name': 'Allowed Name'}).eq('id', user_id).execute()

        for protected_change in (
            {'role': 'superadmin'},
            {'status': 'pending'},
            {'department': 'OTHER'},
            {'email': 'changed@example.invalid'},
        ):
            with pytest.raises(APIError):
                ordinary.table('profiles').update(protected_change).eq('id', user_id).execute()

        with pytest.raises(APIError):
            ordinary.table('profiles').update({
                'avatar_url': 'https://tracker.invalid/avatar.png',
            }).eq('id', user_id).execute()

        avatar_path = f'{user_id}/integration-avatar.png'
        ordinary.storage.from_('avatars').upload(
            avatar_path,
            b'not-a-real-image-but-storage-policy-scoped',
            file_options={'content-type': 'image/png'},
        )
        ordinary.table('profiles').update({'avatar_url': avatar_path}).eq('id', user_id).execute()

        for backend_only_table in ('papers', 'chunks', 'chat_sessions', 'scan_history'):
            with pytest.raises(APIError):
                ordinary.table(backend_only_table).select('*').limit(1).execute()

        pdf_path = f'integration-{uuid.uuid4().hex}.pdf'
        service.storage.from_('pdfs').upload(
            pdf_path,
            b'%PDF-1.4\n%%EOF',
            file_options={'content-type': 'application/pdf'},
        )
        with pytest.raises(Exception):
            ordinary.storage.from_('pdfs').download(pdf_path)
    finally:
        if avatar_path:
            service.storage.from_('avatars').remove([avatar_path])
        if pdf_path:
            service.storage.from_('pdfs').remove([pdf_path])
        if user_id:
            service.auth.admin.delete_user(user_id)


@pytest.mark.integration
def test_durable_queue_is_exclusive_service_only_and_atomic():
    """Exercise the applied queue migration only in an authorized disposable project."""
    url, anon_key, service_key = _disposable_config()
    service = create_client(url, service_key)
    anonymous = create_client(url, anon_key)
    user_id = None
    job_id = str(uuid.uuid4())
    idempotency_key = str(uuid.uuid4())
    worker_ids = ('integration-worker-a', 'integration-worker-b')
    try:
        created = service.auth.admin.create_user({
            'email': f'codex-queue-{uuid.uuid4().hex}@example.invalid',
            'password': f'Test!{uuid.uuid4().hex}aA1',
            'email_confirm': True,
        })
        user_id = str(created.user.id)
        source_path = f'uploads/{user_id}/{job_id}/paper.pdf'
        reserved = service.rpc('reserve_upload_job', {
            'p_job_id': job_id,
            'p_owner_id': user_id,
            'p_department': 'CCSICT',
            'p_idempotency_key': idempotency_key,
            'p_source_path': source_path,
            'p_original_filename': 'paper.pdf',
            'p_content_sha256': 'a' * 64,
            'p_request_payload': {'title': 'Disposable Queue Contract'},
            'p_max_attempts': 3,
        }).execute().data
        assert reserved and reserved[0]['created'] is True
        duplicate = service.rpc('reserve_upload_job', {
            'p_job_id': str(uuid.uuid4()),
            'p_owner_id': user_id,
            'p_department': 'CCSICT',
            'p_idempotency_key': idempotency_key,
            'p_source_path': 'ignored-for-the-existing-job.pdf',
            'p_original_filename': 'paper.pdf',
            'p_content_sha256': 'a' * 64,
            'p_request_payload': {'title': 'Ignored Duplicate'},
            'p_max_attempts': 3,
        }).execute().data
        assert duplicate[0]['created'] is False
        assert str(duplicate[0]['job_id']) == job_id
        assert service.rpc('queue_upload_job', {
            'p_job_id': job_id, 'p_owner_id': user_id,
        }).execute().data is True

        with pytest.raises(APIError):
            anonymous.rpc('claim_upload_job', {
                'p_worker_id': 'unauthorized-worker', 'p_lease_seconds': 120,
            }).execute()
        with pytest.raises(APIError):
            anonymous.table('upload_jobs').select('id').limit(1).execute()

        def claim(worker_id):
            client = create_client(url, service_key)
            return client.rpc('claim_upload_job', {
                'p_worker_id': worker_id, 'p_lease_seconds': 120,
            }).execute().data

        with ThreadPoolExecutor(max_workers=2) as executor:
            first_claims = list(executor.map(claim, worker_ids))
        winners = [rows for rows in first_claims if rows]
        assert len(winners) == 1
        first_worker = str(winners[0][0]['lease_owner'])
        assert service.rpc('heartbeat_upload_job', {
            'p_job_id': job_id,
            'p_worker_id': 'wrong-worker',
            'p_lease_seconds': 120,
            'p_stage': None,
            'p_progress': None,
            'p_message': None,
        }).execute().data is False

        service.table('upload_jobs').update({
            'lease_expires_at': (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
        }).eq('id', job_id).execute()
        with ThreadPoolExecutor(max_workers=2) as executor:
            reclaimed = list(executor.map(claim, ('reclaimer-a', 'reclaimer-b')))
        reclaim_winners = [rows for rows in reclaimed if rows]
        assert len(reclaim_winners) == 1
        final_worker = str(reclaim_winners[0][0]['lease_owner'])
        assert final_worker != first_worker
        assert int(reclaim_winners[0][0]['attempt_count']) == 2

        embedding = [1.0] + [0.0] * 767
        paper = {
            'id': job_id,
            'title': 'Disposable Queue Contract',
            'authors': 'Integration Test',
            'year': 2026,
            'abstract': '',
            'track': 'Data Mining',
            'filename': 'paper.pdf',
            'storage_path': source_path,
            'chunk_count': 1,
            'uploaded_by': user_id,
            'department': 'CCSICT',
            'redaction_stats': {},
            'duplication_scan': {'flagged': False},
            'index_provenance': {
                'embedding_model': 'models/gemini-embedding-2',
                'embedding_dimensions': 768,
                'preprocessing_version': 'document-v1',
                'chunking_version': 'token-v1',
                'tokenizer': 'cl100k_base',
                'chunk_size_tokens': 800,
                'chunk_overlap_tokens': 100,
                'provenance_status': 'verified',
            },
        }
        chunks = [{
            'chunk_index': 0,
            'content': 'Disposable atomic-ingestion integration evidence.',
            'embedding': embedding,
            'metadata': {'title': paper['title']},
            'page_start': 1,
            'page_end': 1,
            'section': 'Integration Test',
        }]
        with pytest.raises(APIError):
            service.rpc('commit_upload_ingestion', {
                'p_job_id': job_id,
                'p_worker_id': first_worker,
                'p_paper': paper,
                'p_chunks': chunks,
            }).execute()
        with pytest.raises(APIError):
            service.rpc('commit_upload_ingestion', {
                'p_job_id': job_id,
                'p_worker_id': final_worker,
                'p_paper': paper,
                'p_chunks': [],
            }).execute()
        assert service.table('papers').select('id').eq('id', job_id).execute().data == []
        committed = service.rpc('commit_upload_ingestion', {
            'p_job_id': job_id,
            'p_worker_id': final_worker,
            'p_paper': paper,
            'p_chunks': chunks,
        }).execute().data
        assert str(committed) == job_id
        job = service.table('upload_jobs').select(
            'status,paper_id,chunks,lease_owner'
        ).eq('id', job_id).single().execute().data
        assert job == {
            'status': 'completed', 'paper_id': job_id, 'chunks': 1, 'lease_owner': None,
        }
        indexed = service.table('papers').select(
            'id,ingestion_status,chunk_count'
        ).eq('id', job_id).single().execute().data
        assert indexed == {'id': job_id, 'ingestion_status': 'ready', 'chunk_count': 1}
    finally:
        for table_name in ('upload_jobs', 'papers'):
            try:
                service.table(table_name).delete().eq('id', job_id).execute()
            except Exception:
                pass
        if user_id:
            try:
                service.auth.admin.delete_user(user_id)
            except Exception:
                pass
