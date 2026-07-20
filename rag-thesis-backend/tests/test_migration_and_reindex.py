"""Static migration contracts and no-network re-index dry-run tests."""

from pathlib import Path

from scripts import reindex_citations


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / 'migrations' / '20260717_rag_items_9_16.sql'
HARDENING_MIGRATION = BACKEND_ROOT / 'migrations' / '20260719_production_hardening.sql'
FULL_SCHEMA = BACKEND_ROOT / 'supabase_setup.sql'


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


class TestReindexDryRun:
    def test_dry_run_has_zero_external_calls(self, tmp_path, capsys):
        fixture = tmp_path / 'fixture.txt'
        fixture.write_text('METHODOLOGY\n' + ('Local fixture evidence. ' * 220), encoding='utf-8')
        exit_code = reindex_citations.main(['--all', '--fixture-dir', str(tmp_path)])
        output = capsys.readouterr().out
        report = __import__('json').loads(output)
        assert exit_code == 0
        assert report['external_calls'] == 0
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
