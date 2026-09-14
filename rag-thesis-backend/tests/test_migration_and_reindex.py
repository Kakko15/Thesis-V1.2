"""Static migration contracts and no-network re-index dry-run tests."""

from pathlib import Path

from scripts import reindex_citations


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / 'migrations' / '20260717_rag_items_9_16.sql'
HARDENING_MIGRATION = BACKEND_ROOT / 'migrations' / '20260719_production_hardening.sql'
PROVENANCE_MIGRATION = BACKEND_ROOT / 'migrations' / '20260720_index_embedding_provenance.sql'
ACTIVE_INDEX_COUNT_MIGRATION = BACKEND_ROOT / 'migrations' / '20260829_reindex_updates_chunk_count.sql'
FULL_SCHEMA = BACKEND_ROOT / 'supabase_setup.sql'


class TestSqlFilesAreApplicable:
    """Guards against SQL that cannot be applied at all.

    supabase_setup.sql shipped for some time with a stray '+' left over from a
    pasted diff on the line introducing the ingestion queue. Postgres reads that
    as an operator followed by a comment and aborts, so the canonical schema
    could not be run against a fresh project — and nothing caught it, because
    every other test only asserts on the file as text.
    """

    def sql_files(self):
        return [FULL_SCHEMA, *sorted((BACKEND_ROOT / 'migrations').glob('*.sql'))]

    def test_no_diff_markers_survive_in_committed_sql(self):
        for path in self.sql_files():
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                # '-' is not checked: '--' is a legitimate SQL comment.
                assert not line.startswith('+'), (
                    f'{path.name}:{number} starts with a diff marker: {line[:60]!r}'
                )

    def test_dollar_quotes_are_balanced(self):
        # An unbalanced $$ swallows everything after it into a string literal, so
        # the file parses as valid SQL while doing almost nothing it should.
        for path in self.sql_files():
            body = path.read_text(encoding='utf-8')
            assert body.count('$$') % 2 == 0, f'{path.name} has an unbalanced $$ pair'


class TestMigrationContract:
    def test_exact_boundary_department_and_active_version_filters(self):
        sql = MIGRATION.read_text(encoding='utf-8').lower()
        assert '>= match_threshold' in sql
        assert '>= dup_threshold' in sql
        assert 'p.department = p_department' in sql
        assert 'c.index_version = p.active_index_version' in sql

    def test_activation_and_pruning_are_service_role_only(self):
        sql = MIGRATION.read_text(encoding='utf-8').lower()
        assert 'revoke all on function public.activate_paper_index' in sql
        assert 'revoke all on function public.prune_inactive_indexes' in sql
        assert 'grant execute on function public.activate_paper_index' in sql
        assert 'grant execute on function public.prune_inactive_indexes' in sql
        assert "newer.index_version <> p.active_index_version" in sql

    def test_legacy_index_backfill_and_count_field_are_unambiguous(self):
        sql = MIGRATION.read_text(encoding='utf-8').lower()
        assert 'set index_version = p.active_index_version' in sql
        assert 'matched_chunk_count integer' in sql
        assert 'alter table public.scan_history add column if not exists matched_chunks' not in sql

    def test_legacy_department_track_arrays_are_normalized_safely(self):
        for path in (MIGRATION, FULL_SCHEMA):
            sql = path.read_text(encoding='utf-8').lower()
            drop_default = 'alter column tracks drop default'
            convert_array = 'alter column tracks type jsonb using to_jsonb(tracks)'
            restore_default = "alter column tracks set default '[]'::jsonb"
            assert drop_default in sql
            assert convert_array in sql
            assert restore_default in sql
            assert sql.index(drop_default) < sql.index(convert_array) < sql.index(restore_default)

    def test_production_hardening_contracts_are_backend_owned(self):
        for path in (HARDENING_MIGRATION, FULL_SCHEMA):
            sql = path.read_text(encoding='utf-8').lower()
            assert 'create table if not exists public.upload_jobs' in sql
            assert 'create or replace function public.save_chat_exchange' in sql
            assert 'and department = p_department' in sql
            assert 'revoke all on table public.scan_history from public, anon, authenticated' in sql
            assert 'pdfs_indirect_access_only' in sql
            assert "'avatars', 'avatars', true" in sql
            assert 'sync_profile_email' in sql
            assert 'on update cascade on delete restrict' in sql

    def test_index_provenance_backfill_retrieval_and_activation_contracts(self):
        for path in (PROVENANCE_MIGRATION, FULL_SCHEMA):
            sql = path.read_text(encoding='utf-8').lower()
            assert 'create table if not exists public.paper_index_versions' in sql
            assert "'models/gemini-embedding-2'" in sql
            assert "'legacy_assumed'" in sql
            assert 'check (embedding_dimensions = 768)' in sql
            assert 'verified_index_provenance_is_current' in sql
            assert "piv.embedding_model = p_embedding_model" in sql
            assert 'piv.embedding_dimensions = p_embedding_dimensions' in sql
            assert 'cannot activate an index without compatible provenance' in sql
            assert 'chunks_index_provenance_fkey' in sql
            assert 'on delete restrict' in sql
            assert 'revoke all on table public.paper_index_versions' in sql

    def test_provenance_pruning_retains_active_and_newest_rollback(self):
        sql = PROVENANCE_MIGRATION.read_text(encoding='utf-8').lower()
        assert 'piv.index_version <> p.active_index_version' in sql
        assert 'newer.index_version <> p.active_index_version' in sql
        assert 'newer.created_at > piv.created_at' in sql
        assert sql.index('delete from public.chunks') < sql.index(
            'delete from public.paper_index_versions'
        )

    def test_active_index_activation_updates_the_displayed_chunk_count(self):
        sql = ACTIVE_INDEX_COUNT_MIGRATION.read_text(encoding='utf-8').lower()
        assert 'select count(*) into v_chunk_count' in sql
        assert 'chunk_count = v_chunk_count' in sql
        assert sql.index('select count(*) into v_chunk_count') < sql.index(
            'set active_index_version = p_index_version'
        )


class TestReindexDryRun:
    def test_dry_run_has_zero_external_calls(self, tmp_path, capsys):
        fixture = tmp_path / 'fixture.txt'
        fixture.write_text('METHODOLOGY\n' + ('Local fixture evidence. ' * 220), encoding='utf-8')
        exit_code = reindex_citations.main(['--all', '--fixture-dir', str(tmp_path)])
        output = capsys.readouterr().out
        report = __import__('json').loads(output)
        assert exit_code == 0
        assert report['external_calls'] == 0
        assert report['intended_index_fingerprint']['embedding_dimensions'] == 768
        assert report['intended_index_fingerprint']['chunking_version'] == 'token-v1'
        fixture_report = report['fixtures'][0]
        assert fixture_report['chunks'] > 0
        assert fixture_report['chunking_version'] == 'token-v1'
        assert fixture_report['tokenizer'] == 'cl100k_base'
        assert fixture_report['token_counts']['maximum'] <= 800
        assert fixture_report['overlap_tokens']['maximum'] <= 100

    def test_failed_staging_cannot_activate_old_index(self):
        class FailingStorage:
            def from_(self, _bucket):
                return self

            def download(self, _path):
                raise FileNotFoundError('missing original')

        class Client:
            storage = FailingStorage()
            activated = False

            def rpc(self, *_args, **_kwargs):
                self.activated = True
                raise AssertionError('activation must not occur')

        client = Client()
        try:
            reindex_citations.apply_paper(client, {
                'id': 'paper-1', 'storage_path': 'missing.pdf', 'filename': 'missing.pdf',
            })
        except FileNotFoundError:
            pass
        assert client.activated is False

    def test_model_change_requires_explicit_apply_authorization(self):
        class Query:
            def select(self, *_args):
                return self

            def eq(self, *_args):
                return self

            def limit(self, *_args):
                return self

            def execute(self):
                return type('Result', (), {'data': [{
                    'embedding_model': 'old-model',
                    'embedding_dimensions': 768,
                    'provenance_status': 'verified',
                }]})()

        class Client:
            storage_touched = False

            def table(self, name):
                assert name == 'paper_index_versions'
                return Query()

            @property
            def storage(self):
                self.storage_touched = True
                raise AssertionError('storage must not be touched before compatibility validation')

        client = Client()
        with __import__('pytest').raises(ValueError, match='--allow-model-change'):
            reindex_citations.apply_paper(client, {
                'id': 'paper-1', 'active_index_version': 'v1',
                'storage_path': 'paper.pdf', 'filename': 'paper.pdf',
            })
        assert client.storage_touched is False

    def test_model_change_flag_is_rejected_without_apply(self):
        with __import__('pytest').raises(ValueError, match='valid only with --apply'):
            reindex_citations.main(['--allow-model-change'])

    def test_current_model_is_not_reindexed_again(self):
        class Query:
            def select(self, *_args):
                return self

            def eq(self, *_args):
                return self

            def limit(self, *_args):
                return self

            def execute(self):
                return type('Result', (), {'data': [{
                    'embedding_model': reindex_citations.settings.gemini_embed_model,
                    'embedding_dimensions': 768,
                    'provenance_status': 'verified',
                }]})()

        class Client:
            storage_touched = False

            def table(self, name):
                assert name == 'paper_index_versions'
                return Query()

            @property
            def storage(self):
                self.storage_touched = True
                raise AssertionError('storage must not be touched when no model migration is needed')

        client = Client()
        assert reindex_citations.apply_paper(client, {
            'id': 'paper-1', 'active_index_version': 'v1',
            'storage_path': 'paper.pdf', 'filename': 'paper.pdf',
        }, allow_model_change=True) is None
        assert client.storage_touched is False

    def test_resume_rejects_state_from_another_index_configuration(self, tmp_path):
        state_path = tmp_path / 'reindex-state.json'
        reindex_citations.save_state({
            'index_fingerprint': {'embedding_model': 'old-model'},
            'completed': [],
            'failed': {},
        }, state_path)
        args = reindex_citations.build_parser().parse_args(['--apply', '--all', '--resume'])

        with __import__('pytest').raises(ValueError, match='different index configuration'):
            reindex_citations.run_apply(args, object(), state_path)


class TestRepairChunkSections:
    """The repair rewrites labels on an already-indexed corpus, so its whole
    safety story is that it refuses to write when the chunk layout it
    re-derives is not the layout that was indexed."""

    class FakeTable:
        def __init__(self, rows, updates):
            self.rows = rows
            self.updates = updates
            self._pending = None

        def select(self, *_args):
            return self

        def update(self, values):
            self._pending = values
            return self

        def eq(self, *_args):
            if self._pending is not None:
                self.updates.append((_args, self._pending))
                self._pending = None
            return self

        def order(self, *_args):
            return self

        def execute(self):
            return type('Result', (), {'data': self.rows})()

    class FakeStorage:
        def from_(self, _bucket):
            return self

        def download(self, _path):
            return b'%PDF-1.4 staged'

    def _client(self, rows, updates):
        storage = self.FakeStorage()
        table = self.FakeTable(rows, updates)

        class Client:
            def table(self, _name):
                return table

        client = Client()
        client.storage = storage
        return client

    def _paper(self):
        return {'id': 'p1', 'title': 'A Thesis', 'filename': 't.pdf', 'storage_path': 's/t.pdf'}

    def test_refuses_to_write_when_content_does_not_reproduce(self, monkeypatch):
        from scripts import repair_chunk_sections

        updates = []
        rows = [
            {'id': 1, 'chunk_index': 0, 'content': 'alpha', 'section': 'NET COST'},
            {'id': 2, 'chunk_index': 1, 'content': 'beta', 'section': 'NET COST'},
        ]
        monkeypatch.setattr(repair_chunk_sections, 'sb', self._client(rows, updates))
        monkeypatch.setattr(repair_chunk_sections, '_rederive', lambda *_args: [
            {'content': 'alpha', 'section': 'METHODOLOGY'},
            {'content': 'DIFFERENT', 'section': 'METHODOLOGY'},
        ])
        report = repair_chunk_sections.repair_paper(self._paper(), apply_changes=True)
        assert report['status'] == 'skipped'
        assert 'chunk 1' in report['reason']
        assert updates == []

    def test_refuses_to_write_when_the_chunk_count_moved(self, monkeypatch):
        from scripts import repair_chunk_sections

        updates = []
        rows = [{'id': 1, 'chunk_index': 0, 'content': 'alpha', 'section': None}]
        monkeypatch.setattr(repair_chunk_sections, 'sb', self._client(rows, updates))
        monkeypatch.setattr(repair_chunk_sections, '_rederive', lambda *_args: [
            {'content': 'alpha', 'section': 'METHODOLOGY'},
            {'content': 'extra', 'section': 'METHODOLOGY'},
        ])
        report = repair_chunk_sections.repair_paper(self._paper(), apply_changes=True)
        assert report['status'] == 'skipped'
        assert 'chunk count moved' in report['reason']
        assert updates == []

    def test_dry_run_plans_only_the_changed_labels_and_writes_nothing(self, monkeypatch):
        from scripts import repair_chunk_sections

        updates = []
        rows = [
            {'id': 1, 'chunk_index': 0, 'content': 'alpha', 'section': 'NET COST'},
            {'id': 2, 'chunk_index': 1, 'content': 'beta', 'section': 'METHODOLOGY'},
        ]
        monkeypatch.setattr(repair_chunk_sections, 'sb', self._client(rows, updates))
        monkeypatch.setattr(repair_chunk_sections, '_rederive', lambda *_args: [
            {'content': 'alpha', 'section': 'METHODOLOGY'},
            {'content': 'beta', 'section': 'METHODOLOGY'},
        ])
        report = repair_chunk_sections.repair_paper(self._paper(), apply_changes=False)
        assert report['status'] == 'planned'
        assert report['changes'] == [(0, 'NET COST', 'METHODOLOGY')]
        assert updates == []

    def test_apply_writes_only_the_changed_label(self, monkeypatch):
        from scripts import repair_chunk_sections

        updates = []
        rows = [
            {'id': 1, 'chunk_index': 0, 'content': 'alpha', 'section': 'NET COST'},
            {'id': 2, 'chunk_index': 1, 'content': 'beta', 'section': 'METHODOLOGY'},
        ]
        monkeypatch.setattr(repair_chunk_sections, 'sb', self._client(rows, updates))
        monkeypatch.setattr(repair_chunk_sections, '_rederive', lambda *_args: [
            {'content': 'alpha', 'section': 'METHODOLOGY'},
            {'content': 'beta', 'section': 'METHODOLOGY'},
        ])
        report = repair_chunk_sections.repair_paper(self._paper(), apply_changes=True)
        assert report['status'] == 'applied'
        assert updates == [(('id', 1), {'section': 'METHODOLOGY'})]


class TestRescanDuplication:
    """The at-upload screening is the only record of what the archive held the
    day a thesis was accepted, and it cannot be recomputed once the archive
    grows. The rescan must nest beside it, never over it."""

    class Recorder:
        def __init__(self, rows):
            self.rows = rows
            self.writes = []
            self._pending = None

        def table(self, _name):
            return self

        def select(self, *_args, **_kwargs):
            return self

        def update(self, values):
            self._pending = values
            return self

        def eq(self, *args):
            if self._pending is not None:
                self.writes.append((args, self._pending))
                self._pending = None
            return self

        def in_(self, *_args):
            return self

        def order(self, *_args):
            return self

        def execute(self):
            return type('Result', (), {'data': self.rows})()

    AT_UPLOAD = {
        'verdict_level': 'review_suggested',
        'matched_chunk_count': 3,
        'total_chunks': 24,
        'matched_chunk_percentage': 12.5,
        'matched_papers': [{'id': 'old-paper'}],
    }
    CURRENT = {
        'verdict_level': 'high_overlap',
        'matched_chunk_count': 22,
        'total_chunks': 24,
        'matched_chunk_percentage': 91.67,
        'matched_papers': [{'id': 'new-paper'}],
    }

    def _paper(self, scan):
        return {'id': 'p1', 'title': 'E-Resources', 'department': 'CCSICT', 'duplication_scan': scan}

    def test_apply_keeps_the_at_upload_record_and_nests_the_rescan(self, monkeypatch):
        from scripts import rescan_duplication

        recorder = self.Recorder([])
        monkeypatch.setattr(rescan_duplication, 'sb', recorder)
        monkeypatch.setattr(rescan_duplication, 'rescan_indexed_paper',
                            lambda *_args: dict(self.CURRENT))
        report = rescan_duplication.rescan_paper(self._paper(dict(self.AT_UPLOAD)), apply_changes=True)

        assert report['changed'] is True
        (_target, written), = recorder.writes
        stored = written['duplication_scan']
        assert stored['verdict_level'] == 'review_suggested'
        assert stored['matched_chunk_percentage'] == 12.5
        assert stored['rescan']['verdict_level'] == 'high_overlap'
        assert stored['rescan']['matched_chunk_percentage'] == 91.67

    def test_rerunning_replaces_only_the_nested_rescan(self, monkeypatch):
        from scripts import rescan_duplication

        recorder = self.Recorder([])
        monkeypatch.setattr(rescan_duplication, 'sb', recorder)
        monkeypatch.setattr(rescan_duplication, 'rescan_indexed_paper',
                            lambda *_args: dict(self.CURRENT))
        already = {**self.AT_UPLOAD, 'rescan': {'verdict_level': 'clear', 'matched_chunk_count': 0}}
        rescan_duplication.rescan_paper(self._paper(already), apply_changes=True)

        (_target, written), = recorder.writes
        stored = written['duplication_scan']
        assert stored['matched_chunk_percentage'] == 12.5
        assert stored['rescan']['verdict_level'] == 'high_overlap'

    def test_dry_run_writes_nothing(self, monkeypatch):
        from scripts import rescan_duplication

        recorder = self.Recorder([])
        monkeypatch.setattr(rescan_duplication, 'sb', recorder)
        monkeypatch.setattr(rescan_duplication, 'rescan_indexed_paper',
                            lambda *_args: dict(self.CURRENT))
        report = rescan_duplication.rescan_paper(self._paper(dict(self.AT_UPLOAD)), apply_changes=False)
        assert report['status'] == 'planned'
        assert recorder.writes == []

    def test_a_failed_rescan_never_writes(self, monkeypatch):
        from scripts import rescan_duplication

        def explode(*_args):
            raise RuntimeError('no such paper')

        recorder = self.Recorder([])
        monkeypatch.setattr(rescan_duplication, 'sb', recorder)
        monkeypatch.setattr(rescan_duplication, 'rescan_indexed_paper', explode)
        report = rescan_duplication.rescan_paper(self._paper(dict(self.AT_UPLOAD)), apply_changes=True)
        assert report['status'] == 'error'
        assert recorder.writes == []
