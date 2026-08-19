"""Thesis category (student | faculty) feature contracts.

The category classifies the manuscript, not the uploader: profiles.role also
has a 'faculty' value and the two are deliberately unrelated. These tests pin
what the feature relies on:

1. The 20260819 migration is additive, backfills to 'student', and ships a
   pre-activation rollback (PI-04 migration-contract style).
2. Retrieval passes p_thesis_category only when a scope was requested, so the
   frozen evaluated pipeline's unfiltered calls stay byte-identical.
3. The API surface validates the two-value enum everywhere it is accepted and
   degrades safely on a pre-migration database.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models import ChatRequest, PaperOut
from routers import papers
from services import retriever
from services.catalog import THESIS_CATEGORIES, normalize_thesis_category

ROOT = Path(__file__).resolve().parents[1]


class TestNormalization:
    def test_absent_input_defaults_to_student(self):
        assert normalize_thesis_category(None) == 'student'
        assert normalize_thesis_category('') == 'student'

    def test_casing_and_whitespace_are_canonicalized(self):
        assert normalize_thesis_category('  Faculty ') == 'faculty'
        assert normalize_thesis_category('STUDENT') == 'student'

    def test_unknown_category_is_a_422(self):
        with pytest.raises(HTTPException) as caught:
            normalize_thesis_category('graduate')
        assert caught.value.status_code == 422

    def test_the_enum_is_exactly_two_values(self):
        assert THESIS_CATEGORIES == {'student', 'faculty'}


class TestMigrationContract:
    """Mirrors the PI-04 additive/rollback assertions in test_catalog.py."""

    def test_migration_is_additive_backfills_student_and_filters_optionally(self):
        migration = (ROOT / 'migrations/20260819_thesis_category.sql').read_text(encoding='utf-8')
        collapsed = ' '.join(migration.lower().split())
        assert (
            "add column if not exists thesis_category text not null default 'student'"
            in collapsed
        )
        assert "check (thesis_category in ('student', 'faculty'))" in collapsed
        # Older queued payloads without the key must hydrate to 'student'.
        assert "nullif(v_payload ->> 'thesis_category', ''), 'student'" in collapsed
        # The retrieval filter must be opt-in so unfiltered calls stay frozen.
        assert 'p_thesis_category text default null' in collapsed
        assert 'p_thesis_category is null or p.thesis_category = p_thesis_category' in collapsed
        assert 'delete from' not in collapsed
        assert 'drop column' not in collapsed

    def test_rollback_restores_the_pre_category_schema(self):
        rollback = (
            ROOT / 'migrations/20260819_thesis_category.rollback.sql'
        ).read_text(encoding='utf-8')
        collapsed = ' '.join(rollback.lower().split())
        assert 'alter table public.papers drop column if exists thesis_category' in collapsed
        assert 'alter table public.upload_jobs drop column if exists thesis_category' in collapsed
        # The seven-argument signature must go so old six-argument calls
        # resolve against the restored function without ambiguity.
        assert (
            'drop function if exists public.match_chunks( vector(768), integer, '
            'double precision, text, text, integer, text )' in collapsed
        )
        assert 'p_thesis_category' not in collapsed.replace(
            'drop function if exists public.match_chunks( vector(768), integer, '
            'double precision, text, text, integer, text )', ''
        ).replace(
            'drop function if exists public.check_topic_duplication( vector(768), '
            'double precision, text, text, integer, text )', ''
        )


class _RpcCapture:
    """Capture rpc arguments; empty rows end retrieval before table lookups."""

    def __init__(self, expected_rpc):
        self.expected_rpc = expected_rpc
        self.rpc_args = None

    def rpc(self, name, args):
        assert name == self.expected_rpc
        self.rpc_args = args
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[]))


class TestRetrievalScope:
    def test_search_chunks_passes_the_category_only_when_requested(self, monkeypatch):
        client = _RpcCapture('match_chunks')
        monkeypatch.setattr(retriever, 'sb', client)
        retriever.search_chunks('query', 'CCSICT', [0.1] * 768, thesis_category='faculty')
        assert client.rpc_args['p_thesis_category'] == 'faculty'

    def test_unfiltered_search_stays_identical_to_the_frozen_pipeline(self, monkeypatch):
        client = _RpcCapture('match_chunks')
        monkeypatch.setattr(retriever, 'sb', client)
        retriever.search_chunks('query', 'CCSICT', [0.1] * 768)
        assert 'p_thesis_category' not in client.rpc_args

    def test_duplication_check_follows_the_same_conditional_contract(self, monkeypatch):
        for category, key_expected in (('student', True), (None, False)):
            client = _RpcCapture('check_topic_duplication')
            monkeypatch.setattr(retriever, 'sb', client)
            retriever.check_topic_duplication('query', None, [0.1] * 768, 'CCSICT', category)
            assert ('p_thesis_category' in client.rpc_args) is key_expected


class TestPublicSource:
    def test_category_is_emitted_only_when_the_lookup_selected_it(self):
        labelled = retriever.public_source(
            {'id': 'p1', 'thesis_category': 'faculty'},
        )
        assert labelled['thesis_category'] == 'faculty'
        # Lookup paths that predate the migration must never mislabel a paper.
        unlabelled = retriever.public_source({'id': 'p1'})
        assert 'thesis_category' not in unlabelled

    def test_a_null_category_from_the_database_reads_as_student(self):
        source = retriever.public_source({'id': 'p1', 'thesis_category': None})
        assert source['thesis_category'] == 'student'


class _RecordingQuery:
    def __init__(self, rows, fail=False):
        self.rows = rows
        self.fail = fail
        self.fields = ''
        self.filters = []

    def select(self, fields):
        self.fields = fields
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def in_(self, *_args):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError('column papers.thesis_category does not exist')
        return SimpleNamespace(data=self.rows)


class _PapersClient:
    def __init__(self, fail_normalized=False):
        self.fail_normalized = fail_normalized
        self.papers_queries = []

    def table(self, name):
        if name == 'profiles':
            return _RecordingQuery([{'role': 'admin', 'department': 'CCSICT'}])
        query = _RecordingQuery([], fail=self.fail_normalized)
        self.papers_queries.append(query)
        return query


class TestPapersEndpoint:
    def test_category_filter_is_normalized_selected_and_applied(self, monkeypatch):
        client = _PapersClient()
        monkeypatch.setattr(papers, 'sb', client)
        papers.list_papers(user=SimpleNamespace(id='admin'), thesis_category='FACULTY')
        query = client.papers_queries[0]
        assert 'thesis_category' in query.fields
        assert ('thesis_category', 'faculty') in query.filters

    def test_unfiltered_listing_leaves_the_category_predicate_off(self, monkeypatch):
        client = _PapersClient()
        monkeypatch.setattr(papers, 'sb', client)
        papers.list_papers(user=SimpleNamespace(id='admin'))
        assert not any(
            field == 'thesis_category' for field, _value in client.papers_queries[0].filters
        )

    def test_category_filter_before_migration_is_a_clear_503(self, monkeypatch):
        client = _PapersClient(fail_normalized=True)
        monkeypatch.setattr(papers, 'sb', client)
        with pytest.raises(HTTPException) as caught:
            papers.list_papers(user=SimpleNamespace(id='admin'), thesis_category='faculty')
        assert caught.value.status_code == 503

    def test_invalid_category_filter_is_rejected(self, monkeypatch):
        monkeypatch.setattr(papers, 'sb', _PapersClient())
        with pytest.raises(HTTPException) as caught:
            papers.list_papers(user=SimpleNamespace(id='admin'), thesis_category='graduate')
        assert caught.value.status_code == 422


class TestApiModels:
    def test_chat_request_accepts_both_categories_and_rejects_others(self):
        scoped = ChatRequest(question='q', thesis_category_filter='faculty')
        assert scoped.thesis_category_filter == 'faculty'
        assert ChatRequest(question='q').thesis_category_filter is None
        with pytest.raises(ValidationError):
            ChatRequest(question='q', thesis_category_filter='both')

    def test_paper_out_defaults_to_student_for_legacy_fallback_rows(self):
        paper = PaperOut(id='p1', title='Legacy thesis', created_at='2026-01-01')
        assert paper.thesis_category == 'student'
