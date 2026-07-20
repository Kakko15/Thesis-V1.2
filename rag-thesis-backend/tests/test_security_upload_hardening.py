"""Security and ingestion tests required by thesis Items 17 and 27."""

from types import SimpleNamespace

import fitz
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app
from routers import upload
from services.document_processor import ExtractedDocument, ExtractedPage, redact_pii


def _pdf_bytes(pages=1):
    document = fitz.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 72), f'Thesis page {index + 1}')
    value = document.tobytes()
    document.close()
    return value


def test_title_page_metadata_has_deterministic_offline_fallback():
    text = """A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation

A Thesis
Presented to the Faculty of the
College of Computing Studies, Information and Communication Technology (CCSICT)
Isabela State University

By:
Ahron John F. Barlis
Carlo Rossi P. Gallardo
"""
    result = upload._extract_title_page_metadata(text, ['CCSICT', 'CAS'])
    assert result == {
        'title': 'A Centralized AI-Powered Thesis Library Using Retrieval-Augmented Generation',
        'authors': 'Ahron John F. Barlis, Carlo Rossi P. Gallardo',
        'year': '',
        'department': 'CCSICT',
    }


class TestStrictIndirectAccess:
    def test_signed_url_route_does_not_exist(self):
        response = TestClient(app, raise_server_exceptions=False).get('/papers/paper-id/url')
        assert response.status_code in (404, 405)


class TestPdfValidation:
    def test_accepts_and_sanitizes_real_pdf(self):
        safe = upload._validate_pdf_upload(
            _pdf_bytes(), r'C:\fakepath\My Thesis (Final).pdf', 'application/pdf',
        )
        assert safe == 'My_Thesis_Final.pdf'

    @pytest.mark.parametrize('filename,mime,content,status', [
        ('paper.txt', 'text/plain', b'plain text', 415),
        ('paper.pdf', 'text/plain', _pdf_bytes(), 415),
        ('paper.pdf', 'application/pdf', b'not a pdf', 422),
        ('paper.pdf', 'application/pdf', b'', 400),
    ])
    def test_rejects_invalid_uploads(self, filename, mime, content, status):
        with pytest.raises(HTTPException) as caught:
            upload._validate_pdf_upload(content, filename, mime)
        assert caught.value.status_code == status

    def test_rejects_page_bomb_limit(self, monkeypatch):
        monkeypatch.setattr(upload.settings, 'max_pdf_pages', 1)
        with pytest.raises(HTTPException, match='page safety limit'):
            upload._validate_pdf_upload(_pdf_bytes(2), 'paper.pdf', 'application/pdf')


class TestPiiCleaning:
    def test_redacts_supported_pii_without_removing_research_text(self):
        text = (
            'The model achieved 91% accuracy.\n'
            'Email: student@example.edu.ph\n'
            'Mobile: +63 917 123 4567\n'
            'Student ID: 21-12345\n'
            'Address: 10 Campus Road, Echague\n'
            'Participant ID: P12\n'
            'Signature: __________'
        )
        cleaned, stats = redact_pii(text)
        assert '91% accuracy' in cleaned
        assert 'student@example.edu.ph' not in cleaned
        assert '+63 917 123 4567' not in cleaned
        assert stats == {
            'email': 1, 'phone': 1, 'student_number': 1,
            'address': 1, 'participant_identifier': 1, 'signature': 1,
        }


class _StorageBucket:
    def __init__(self, fail_upload=False, fail_remove=False):
        self.fail_upload = fail_upload
        self.fail_remove = fail_remove
        self.uploaded = []
        self.removed = []

    def upload(self, path, _content, file_options=None):
        if self.fail_upload:
            raise RuntimeError('storage unavailable')
        self.uploaded.append((path, file_options))

    def remove(self, paths):
        if self.fail_remove:
            raise RuntimeError('storage delete unavailable')
        self.removed.extend(paths)


class _Storage:
    def __init__(self, bucket):
        self.bucket = bucket

    def from_(self, _name):
        return self.bucket


class _IngestClient:
    def __init__(self, bucket):
        self.storage = _Storage(bucket)


class _RpcQuery:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error

    def execute(self):
        if self.error:
            raise self.error
        return SimpleNamespace(data=self.data)


class _ResultQuery:
    def __init__(self, data=None, capture=None):
        self.data = data
        self.capture = capture

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def single(self): return self
    def insert(self, payload):
        if self.capture is not None:
            self.capture.append(payload)
        return self
    def execute(self): return SimpleNamespace(data=self.data)


class _SuccessClient(_IngestClient):
    def __init__(self, bucket):
        super().__init__(bucket)
        self.rpc_calls = []

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        return _RpcQuery(data=payload['p_paper']['id'])


class _AmbiguousCommitClient(_SuccessClient):
    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        return _RpcQuery(error=TimeoutError('response lost'))

    def table(self, name):
        assert name == 'papers'
        return _ResultQuery({'ingestion_status': 'ready', 'chunk_count': 1})


class _RollbackQueueClient(_SuccessClient):
    def __init__(self, bucket):
        super().__init__(bucket)
        self.cleanup_rows = []

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        return _RpcQuery(error=RuntimeError('transaction rejected'))

    def table(self, name):
        if name == 'papers':
            return _ResultQuery(None)
        if name == 'storage_cleanup_queue':
            return _ResultQuery([], self.cleanup_rows)
        raise AssertionError(name)


def _prepared_document():
    return ExtractedDocument(
        [ExtractedPage(1, 'A sufficiently clean thesis paragraph describing the research method.')],
        {'email': 1},
    )


class TestUploadJobSecurityAndRollback:
    def setup_method(self):
        upload._JOBS.clear()

    def test_job_status_is_owner_only(self):
        upload._set_job('job-1', owner_id='owner', status='queued')
        result = upload.upload_status('job-1', user=SimpleNamespace(id='owner'))
        assert result.status == 'queued'
        with pytest.raises(HTTPException) as caught:
            upload.upload_status('job-1', user=SimpleNamespace(id='attacker'))
        assert caught.value.status_code == 404

    def test_job_status_uses_durable_database_record(self, monkeypatch):
        captured = []

        class Query:
            def select(self, *_args): return self
            def eq(self, *_args): return self
            def limit(self, *_args): return self
            def update(self, payload):
                captured.append(payload)
                return self
            def execute(self):
                return SimpleNamespace(data=[{
                    'id': 'job-db', 'owner_id': 'owner', 'department': 'CCSICT',
                    'status': 'processing', 'stage': 'embed', 'progress': 60,
                    'message': 'Embedding', 'updated_at': None,
                }])

        monkeypatch.setattr(upload, 'sb', SimpleNamespace(table=lambda _name: Query()))
        upload._set_job('job-db', status='processing', stage='embed', progress=60)
        assert captured[0]['status'] == 'processing'
        result = upload.upload_status('job-db', user=SimpleNamespace(id='owner'))
        assert result.stage == 'embed' and result.progress == 60

    def test_storage_failure_is_fatal(self, monkeypatch):
        bucket = _StorageBucket(fail_upload=True)
        monkeypatch.setattr(upload, 'sb', _IngestClient(bucket))
        monkeypatch.setattr(upload, 'extract_document', lambda *_: _prepared_document())
        upload._ingest('job', _pdf_bytes(), 'paper.pdf', 'Title', 'Author', '2026', '', '', 'CCSICT', 'u1')
        assert upload._JOBS['job']['status'] == 'failed'

    def test_embedding_failure_removes_stored_original(self, monkeypatch):
        bucket = _StorageBucket()
        monkeypatch.setattr(upload, 'sb', _IngestClient(bucket))
        monkeypatch.setattr(upload, 'extract_document', lambda *_: _prepared_document())
        monkeypatch.setattr(upload, 'split_document', lambda *_: [{
            'content': 'Clean research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': 'Methodology',
        }])
        monkeypatch.setattr(upload, 'is_noise_chunk', lambda *_: False)
        monkeypatch.setattr(upload, 'embed_texts', lambda *_: (_ for _ in ()).throw(RuntimeError('provider error')))
        upload._ingest('job', _pdf_bytes(), 'paper.pdf', 'Title', 'Author', '2026', '', '', 'CCSICT', 'u1')
        assert upload._JOBS['job']['status'] == 'failed'
        assert len(bucket.removed) == 1

    def test_successful_ingestion_activates_only_verified_complete_index(self, monkeypatch):
        bucket = _StorageBucket()
        client = _SuccessClient(bucket)
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'extract_document', lambda *_: _prepared_document())
        monkeypatch.setattr(upload, 'split_document', lambda *_: [{
            'content': 'Clean research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': 'Methodology',
        }])
        monkeypatch.setattr(upload, 'is_noise_chunk', lambda *_: False)
        monkeypatch.setattr(upload, 'embed_texts', lambda *_: [[0.1] * 768])
        monkeypatch.setattr(upload, 'screen_new_submission', lambda *_: {'flagged': False})
        monkeypatch.setattr(upload, 'log_activity', lambda *_args, **_kwargs: None)
        upload._ingest('job', _pdf_bytes(), 'paper.pdf', 'Title', 'Author', '2026', '', 'Data Mining', 'CCSICT', 'u1')
        assert upload._JOBS['job']['status'] == 'completed'
        name, payload = client.rpc_calls[0]
        assert name == 'commit_paper_ingestion'
        assert payload['p_paper']['redaction_stats'] == {'email': 1}
        assert payload['p_paper']['department'] == 'CCSICT'
        assert payload['p_paper']['index_provenance'] == {
            'embedding_model': upload.settings.gemini_embed_model,
            'embedding_dimensions': 768,
            'preprocessing_version': 'document-v1',
            'chunking_version': 'token-v1',
            'tokenizer': 'cl100k_base',
            'chunk_size_tokens': 800,
            'chunk_overlap_tokens': 100,
            'provenance_status': 'verified',
        }
        assert len(payload['p_chunks']) == 1
        assert len(payload['p_chunks'][0]['embedding']) == 768
        assert bucket.removed == []

    def test_embedding_dimension_mismatch_rolls_back_storage(self, monkeypatch):
        bucket = _StorageBucket()
        monkeypatch.setattr(upload, 'sb', _IngestClient(bucket))
        monkeypatch.setattr(upload, 'extract_document', lambda *_: _prepared_document())
        monkeypatch.setattr(upload, 'split_document', lambda *_: [{
            'content': 'Clean research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': None,
        }])
        monkeypatch.setattr(upload, 'is_noise_chunk', lambda *_: False)
        monkeypatch.setattr(upload, 'embed_texts', lambda *_: [[0.1] * 2])
        upload._ingest('job', _pdf_bytes(), 'paper.pdf', 'Title', 'Author', '2026', '', '', 'CCSICT', 'u1')
        assert upload._JOBS['job']['status'] == 'failed'
        assert len(bucket.removed) == 1

    def test_ambiguous_rpc_response_recovers_confirmed_commit(self, monkeypatch):
        bucket = _StorageBucket()
        client = _AmbiguousCommitClient(bucket)
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'extract_document', lambda *_: _prepared_document())
        monkeypatch.setattr(upload, 'split_document', lambda *_: [{
            'content': 'Clean research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': None,
        }])
        monkeypatch.setattr(upload, 'is_noise_chunk', lambda *_: False)
        monkeypatch.setattr(upload, 'embed_texts', lambda *_: [[0.1] * 768])
        monkeypatch.setattr(upload, 'screen_new_submission', lambda *_: {'flagged': False})
        monkeypatch.setattr(upload, 'log_activity', lambda *_args, **_kwargs: None)
        upload._ingest(
            '11111111-1111-4111-8111-111111111111', _pdf_bytes(), 'paper.pdf',
            'Title', 'Author', '2026', '', '', 'CCSICT', 'u1',
        )
        assert upload._JOBS['11111111-1111-4111-8111-111111111111']['status'] == 'completed'
        assert bucket.removed == []

    def test_failed_storage_compensation_is_persisted(self, monkeypatch):
        bucket = _StorageBucket(fail_remove=True)
        client = _RollbackQueueClient(bucket)
        monkeypatch.setattr(upload, 'sb', client)
        monkeypatch.setattr(upload, 'extract_document', lambda *_: _prepared_document())
        monkeypatch.setattr(upload, 'split_document', lambda *_: [{
            'content': 'Clean research content', 'chunk_index': 0,
            'page_start': 1, 'page_end': 1, 'section': None,
        }])
        monkeypatch.setattr(upload, 'is_noise_chunk', lambda *_: False)
        monkeypatch.setattr(upload, 'embed_texts', lambda *_: [[0.1] * 768])
        monkeypatch.setattr(upload, 'screen_new_submission', lambda *_: {'flagged': False})
        upload._ingest(
            '22222222-2222-4222-8222-222222222222', _pdf_bytes(), 'paper.pdf',
            'Title', 'Author', '2026', '', '', 'CCSICT', 'u1',
        )
        assert upload._JOBS['22222222-2222-4222-8222-222222222222']['status'] == 'failed'
        assert client.cleanup_rows[0]['operation'] == 'rollback_upload'
        assert client.cleanup_rows[0]['paper_id'] is None


class TestSqlSecurityContracts:
    def test_setup_rejects_privileged_signup_and_protects_profile_fields(self):
        sql = open('supabase_setup.sql', encoding='utf-8').read().lower()
        assert "requested_role' = 'faculty'" in sql
        assert "requested_role') in ('faculty', 'admin')" not in sql
        assert 'protect_profile_security_fields' in sql
        assert 'grant update (full_name, avatar_url)' in sql
        assert 'avatar must be an existing object owned by the profile owner' in sql
        assert 'avatar_url text' in sql
        assert sql.index('avatar_url text') < sql.index('grant update (full_name, avatar_url)')
        assert "new.raw_user_meta_data ->> 'department'" not in sql
        assert "'ccsict', -- public registration" in sql

    def test_processing_papers_are_excluded_from_both_retrieval_rpcs(self):
        sql = open('supabase_setup.sql', encoding='utf-8').read().lower()
        assert sql.count("p.ingestion_status = 'ready'") >= 2

    def test_atomic_ingestion_and_cleanup_queue_are_service_role_only(self):
        sql = open('supabase_setup.sql', encoding='utf-8').read().lower()
        assert 'function public.commit_paper_ingestion' in sql
        assert 'inserted chunk count verification failed' in sql
        assert 'storage_cleanup_queue' in sql
        assert 'revoke all on function public.commit_paper_ingestion' in sql
        assert 'grant execute on function public.commit_paper_ingestion' in sql
