"""Guards against SQL definitions drifting apart between files.

Two failure modes, both found the hard way on 2026-08-04 while preparing a
disposable project for the `/chat` load test.

**An earlier migration can overwrite a later one.** `create or replace function`
keeps whichever body ran last, so replaying `20260718` after `20260720` silently
reverted `commit_paper_ingestion` to a version that predates index provenance.
Every insert into `papers` then failed a foreign key, with nothing in the schema
looking obviously wrong. Applying migrations in filename order avoids it; nothing
enforced that, and nothing detected the result.

**`supabase_setup.sql` can fall behind the migrations.** It is the base schema a
fresh project is built from, and it is hand-maintained, so it can drift from the
newest migration. `commit_upload_ingestion` had lost its cancellation guard that
way: a project built from the base file alone would let a successful commit
overwrite a cancellation requested mid-pipeline.

These tests do not attempt to auto-reconcile the two sources -- for
`match_chunks` and `check_topic_duplication` that would mean editing the frozen
evaluated pipeline's substrate before the defense. They pin the known
differences so the set cannot grow unnoticed, and they assert the specific
guarantees that must hold in both files.
"""

import pathlib
import re
from collections import defaultdict

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
BASE_SCHEMA = BACKEND / 'supabase_setup.sql'
MIGRATION_DIR = BACKEND / 'migrations'

_DEFINITION = re.compile(
    r'create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(', re.IGNORECASE)


def migration_files() -> list[pathlib.Path]:
    """Forward migrations only, in the filename order the README prescribes."""
    return sorted(
        path for path in MIGRATION_DIR.glob('*.sql')
        if '.rollback.' not in path.name
    )


def function_definitions(path: pathlib.Path) -> dict[str, list[str]]:
    """Map function name -> every full definition text in this file."""
    text = path.read_text(encoding='utf-8')
    found: dict[str, list[str]] = defaultdict(list)
    for match in _DEFINITION.finditer(text):
        start = match.start()
        end = text.find('$$;', start)
        if end == -1:
            continue
        found[match.group(1)].append(text[start:end + 3])
    return dict(found)


def normalize(sql: str) -> str:
    """Compare logic, not layout.

    Whitespace is removed rather than collapsed. Collapsing runs of spaces still
    reported two functions as different when the only difference was where the
    argument list wrapped across lines, which sent an earlier version of this
    audit chasing a defect that did not exist.
    """
    return re.sub(r'\s+', '', re.sub(r'--[^\n]*', '', sql)).lower()


def newest_migration_definition() -> dict[str, tuple[str, str]]:
    """Function -> (migration filename, definition) for the last definer."""
    newest: dict[str, tuple[str, str]] = {}
    for path in migration_files():
        for function, definitions in function_definitions(path).items():
            newest[function] = (path.name, definitions[-1])
    return newest


# ---------------------------------------------------------------------------
# Known, dated differences between supabase_setup.sql and the newest migration.
#
# Each entry is a decision, not an oversight. Removing an entry when the drift is
# reconciled is required -- test_no_stale_allowlist_entries fails otherwise, so
# this list cannot quietly outlive the problem it documents.
# ---------------------------------------------------------------------------
KNOWN_BASE_SCHEMA_DRIFT = {
    'match_chunks': (
        'Base file implements it as language plpgsql; the migration uses '
        'language sql stable. Both return the same rows. Reconciling means '
        'editing the frozen evaluated retrieval path, so it waits until after '
        'the defense baseline is locked.'
    ),
    'check_topic_duplication': (
        'Same plpgsql-versus-sql difference as match_chunks, and equally part of '
        'the frozen duplication-screening path.'
    ),
    'claim_upload_job': (
        'Queue function reformatted and extended across 20260723 -> 20260724. '
        'Needs a per-branch read before reconciling; the durable queue is '
        'covered by its own tests, so a silent behaviour change here would be '
        'caught by them rather than by this file.'
    ),
    'claim_upload_cleanup': 'Same 20260723 -> 20260724 queue reformatting as claim_upload_job.',
    'expire_upload_jobs': 'Same 20260723 -> 20260724 queue reformatting as claim_upload_job.',
    'schedule_upload_retry': 'Same 20260723 -> 20260724 queue reformatting as claim_upload_job.',
}


class TestTheScannerWorks:
    """Guard the guards: a broken parser would make every check below vacuous."""

    def test_both_sources_define_functions(self):
        assert len(function_definitions(BASE_SCHEMA)) >= 15
        assert len(newest_migration_definition()) >= 25

    def test_migration_files_are_discovered_without_rollbacks(self):
        names = [path.name for path in migration_files()]
        assert names, 'no migrations found'
        assert not any('.rollback.' in name for name in names)
        assert names == sorted(names), 'filename order is what the README relies on'

    def test_normalization_ignores_layout_but_not_logic(self):
        assert normalize('create or replace function public.f(\n  a int\n)') == \
            normalize('create or replace function public.f(a int)')
        assert normalize('language sql') != normalize('language plpgsql')

    def test_a_planted_difference_is_detected(self):
        assert normalize('begin return 1; end') != normalize('begin return 2; end')


class TestBaseSchemaMatchesNewestMigration:
    """supabase_setup.sql builds fresh projects; stale copies here ship bugs."""

    def test_no_undeclared_drift(self):
        base = function_definitions(BASE_SCHEMA)
        newest = newest_migration_definition()
        drifted = {}
        for function in sorted(set(base) & set(newest)):
            migration_name, migration_body = newest[function]
            if normalize(base[function][-1]) != normalize(migration_body):
                drifted[function] = migration_name
        undeclared = {
            function: name for function, name in drifted.items()
            if function not in KNOWN_BASE_SCHEMA_DRIFT
        }
        assert not undeclared, (
            'supabase_setup.sql disagrees with the newest migration for '
            f'{undeclared}. Either sync the base file, or add the function to '
            'KNOWN_BASE_SCHEMA_DRIFT with the reason it is deliberate.'
        )

    def test_no_stale_allowlist_entries(self):
        """An entry whose drift is gone must be deleted, so the list stays true."""
        base = function_definitions(BASE_SCHEMA)
        newest = newest_migration_definition()
        resolved = []
        for function in KNOWN_BASE_SCHEMA_DRIFT:
            if function not in base or function not in newest:
                resolved.append(function)
                continue
            if normalize(base[function][-1]) == normalize(newest[function][1]):
                resolved.append(function)
        assert not resolved, (
            f'these no longer drift and must be removed from '
            f'KNOWN_BASE_SCHEMA_DRIFT: {resolved}'
        )


class TestGuaranteesThatMustHoldInBothFiles:
    """Specific behaviours that a stale copy has already silently dropped once."""

    @pytest.mark.parametrize('source', ['base', 'migration'])
    def test_commit_upload_ingestion_refuses_a_cancelled_job(self, source):
        if source == 'base':
            definitions = function_definitions(BASE_SCHEMA)['commit_upload_ingestion']
            body = definitions[-1]
        else:
            body = newest_migration_definition()['commit_upload_ingestion'][1]
        collapsed = re.sub(r'\s+', ' ', body).lower()
        assert 'cancel_requested_at is not null' in collapsed, (
            f'the {source} copy lost the cancellation guard: a commit could '
            'overwrite a cancellation requested mid-pipeline'
        )
        assert 'upload cancellation was requested' in collapsed

    @pytest.mark.parametrize('source', ['base', 'migration'])
    def test_commit_paper_ingestion_requires_verified_provenance(self, source):
        """The version predating index provenance writes no
        paper_index_versions row, so every chunk insert then violates its
        foreign key. That is precisely what an out-of-order replay restored."""
        if source == 'base':
            body = function_definitions(BASE_SCHEMA)['commit_paper_ingestion'][-1]
        else:
            body = newest_migration_definition()['commit_paper_ingestion'][1]
        collapsed = re.sub(r'\s+', ' ', body).lower()
        assert 'paper_index_versions' in collapsed
        assert 'provenance' in collapsed


class TestEarlierMigrationsCannotOverwriteLaterOnes:
    """The out-of-order replay hazard, made visible.

    A function defined by several migrations is fine as long as the last
    definition in filename order is the authoritative one -- which is what
    applying them in order guarantees. What is *not* fine is an operator
    reapplying one older file, so every such function is listed here with the
    chain it travelled, and the count is pinned.
    """

    def test_redefined_functions_are_inventoried(self):
        per_migration = {path.name: function_definitions(path) for path in migration_files()}
        chains: dict[str, list[str]] = defaultdict(list)
        for name in sorted(per_migration):
            for function in per_migration[name]:
                chains[function].append(name)
        redefined = {f: names for f, names in chains.items() if len(names) > 1}

        # Pinned so a new cross-migration redefinition has to be considered
        # rather than merged unnoticed.
        assert set(redefined) == {
            'activate_paper_index', 'check_topic_duplication', 'claim_upload_cleanup',
            'claim_upload_job', 'commit_paper_ingestion', 'commit_upload_ingestion',
            'expire_upload_jobs', 'handle_new_user', 'match_chunks',
            'prune_inactive_indexes', 'save_chat_exchange', 'schedule_upload_retry',
            'upsert_operational_alert',
        }, (
            'the set of functions redefined across migrations changed: '
            f'{sorted(redefined)}. Confirm the newest definition is still the '
            'authoritative one, then update this set.'
        )

    def test_every_redefinition_chain_ends_at_the_newest_file(self):
        """Sanity: the authoritative definition is the highest filename, which is
        what makes 'apply in filename order' a sufficient instruction."""
        per_migration = {path.name: function_definitions(path) for path in migration_files()}
        newest = newest_migration_definition()
        for function, (winner, _body) in newest.items():
            definers = [name for name, defs in per_migration.items() if function in defs]
            assert winner == max(definers), (
                f'{function}: newest_migration_definition chose {winner} but the '
                f'highest filename is {max(definers)}'
            )
