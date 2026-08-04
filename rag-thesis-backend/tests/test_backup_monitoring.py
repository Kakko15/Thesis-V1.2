"""Regression tests for §8.1 — backup staleness had no observer.

The backup tooling already produced encrypted, hashed, verifiable backups. What
was missing is that nothing outside the backup machine knew whether a backup had
actually run: a nightly task that stopped firing — an expired account password, a
machine left off, a full disk — looked exactly like a healthy system from the
API's point of view.

These tests pin the observer: successful runs are recorded, the operations
monitor alerts when the newest one exceeds the declared RPO, and the check stays
silent when it has not been configured.
"""

import pathlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config import settings
from services import operations

BACKEND = pathlib.Path(__file__).resolve().parent.parent
MIGRATION = BACKEND / 'migrations' / '20260804_backup_runs.sql'
ROLLBACK = BACKEND / 'migrations' / '20260804_backup_runs.rollback.sql'
RECORDER = BACKEND / 'scripts' / 'record_backup_run.ps1'
SCHEDULER = BACKEND / 'scripts' / 'scheduled_backup.ps1'
DRILL_DOC = BACKEND.parent / 'docs' / 'BACKUP_RESTORE_DRILL.md'

NOW = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)


class FakeTable:
    def __init__(self, rows, fail=False):
        self.rows = rows
        self.fail = fail
        self.selected = None

    def select(self, fields):
        self.selected = fields
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, _count):
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError('relation "backup_runs" does not exist')
        return SimpleNamespace(data=self.rows)


class FakeClient:
    def __init__(self, rows=None, fail=False):
        self.table_obj = FakeTable(rows or [], fail=fail)
        self.requested = []

    def table(self, name):
        self.requested.append(name)
        return self.table_obj


def backup_row(age_hours, backup_id='2026-08-04-020000'):
    completed = NOW - timedelta(hours=age_hours)
    return {
        'backup_id': backup_id,
        'completed_at': completed.isoformat(),
        'artifact_count': 4,
        'total_bytes': 1234567,
    }


@pytest.fixture(name='rpo')
def rpo_fixture(monkeypatch):
    monkeypatch.setattr(settings, 'backup_rpo_hours', 24)


class TestTheCheckIsOffUntilConfigured:
    def test_the_shipped_default_disables_the_check(self):
        assert settings.backup_rpo_hours == 0

    def test_a_zero_rpo_adds_no_condition_and_reads_nothing(self):
        client = FakeClient([backup_row(999)])
        assert operations._backup_condition(client, NOW) is None
        # Returning None rather than an inactive condition matters: an inactive
        # condition would resolve a `backup_stale` alert the operator never
        # asked for, which is a write, not a no-op.
        assert client.requested == []

    def test_a_declared_rto_is_still_recorded_when_monitoring_is_off(self):
        assert settings.backup_rto_hours >= 1


class TestStalenessAgainstTheDeclaredRpo:
    def test_a_fresh_backup_is_not_stale(self, rpo):
        active, alert_type, severity, details = operations._backup_condition(
            FakeClient([backup_row(6)]), NOW,
        )
        assert active is False
        assert alert_type == 'backup_stale'
        assert severity == 'critical'
        assert details['age_hours'] == 6.0
        assert details['rpo_hours'] == 24

    def test_a_backup_older_than_the_rpo_is_stale(self, rpo):
        active, _type, _severity, details = operations._backup_condition(
            FakeClient([backup_row(30)]), NOW,
        )
        assert active is True
        assert details['age_hours'] == 30.0

    def test_a_backup_exactly_at_the_rpo_is_not_yet_stale(self, rpo):
        active, _type, _severity, _details = operations._backup_condition(
            FakeClient([backup_row(24)]), NOW,
        )
        assert active is False

    def test_no_recorded_backup_at_all_is_the_most_severe_case(self, rpo):
        active, _type, severity, details = operations._backup_condition(
            FakeClient([]), NOW,
        )
        assert active is True
        assert severity == 'critical'
        assert details['recorded_backups'] == 0

    def test_a_future_timestamp_never_reports_negative_age(self, rpo):
        active, _type, _severity, details = operations._backup_condition(
            FakeClient([backup_row(-5)]), NOW,
        )
        assert details['age_hours'] == 0.0
        assert active is False

    def test_an_unparseable_timestamp_fails_stale_rather_than_fresh(self, rpo):
        row = backup_row(1)
        row['completed_at'] = 'not-a-timestamp'
        active, _type, _severity, _details = operations._backup_condition(
            FakeClient([row]), NOW,
        )
        assert active is True

    def test_the_alert_details_carry_both_targets_and_no_paths(self, rpo):
        _active, _type, _severity, details = operations._backup_condition(
            FakeClient([backup_row(30)]), NOW,
        )
        assert details['rpo_hours'] == 24
        assert details['rto_hours'] == settings.backup_rto_hours
        serialized = repr(details).lower()
        for leak in ('c:\\', '/home/', 'users', '.sql', 'isubackup'):
            assert leak not in serialized, details


class TestAMissingTableDoesNotBreakOperations:
    """The migration is additive and the feature is off by default, so a
    deployment that has not applied it must still get worker and queue health."""

    def test_a_failing_lookup_is_treated_as_no_recorded_backup(self, rpo):
        active, _type, _severity, details = operations._backup_condition(
            FakeClient(fail=True), NOW,
        )
        assert active is True
        assert details['recorded_backups'] == 0

    def test_newest_backup_returns_none_instead_of_raising(self):
        assert operations.newest_backup(FakeClient(fail=True)) is None

    def test_newest_backup_reads_only_privacy_safe_columns(self):
        client = FakeClient([backup_row(1)])
        operations.newest_backup(client)
        requested = set(client.table_obj.selected.split(','))
        assert requested == {'backup_id', 'completed_at', 'artifact_count', 'total_bytes'}
        assert 'host_fingerprint' not in requested


class TestTheMigrationIsPrivateAndAdditive:
    @pytest.fixture(name='sql')
    def sql_fixture(self):
        return MIGRATION.read_text(encoding='utf-8').lower()

    def test_the_table_and_rpc_exist(self, sql):
        assert 'create table if not exists public.backup_runs' in sql
        assert 'create or replace function public.record_backup_run' in sql

    def test_row_level_security_is_enabled_and_writes_are_not_granted(self, sql):
        assert 'alter table public.backup_runs enable row level security' in sql
        assert 'revoke all on table public.backup_runs from public, anon, authenticated' in sql
        assert 'grant select on table public.backup_runs to service_role' in sql
        # Recording goes through the checked RPC, not a direct insert grant.
        assert 'grant insert on table public.backup_runs' not in sql
        assert 'grant all on table public.backup_runs' not in sql

    def test_the_rpc_is_reachable_only_by_the_service_role(self, sql):
        assert 'revoke all on function public.record_backup_run' in sql
        assert 'grant execute on function public.record_backup_run' in sql
        assert 'to service_role' in sql

    def test_an_empty_backup_cannot_be_recorded(self, sql):
        # Recording an artifact-free run would silence the alert for nothing.
        assert 'must record at least one artifact' in sql

    def test_recording_the_same_run_twice_updates_rather_than_duplicates(self, sql):
        assert 'on conflict (backup_id) do update' in sql

    def test_a_rollback_exists(self):
        rollback = ROLLBACK.read_text(encoding='utf-8').lower()
        assert 'drop table if exists public.backup_runs' in rollback
        assert 'drop function if exists public.record_backup_run' in rollback


class TestTheRecorderScript:
    @pytest.fixture(name='script')
    def script_fixture(self):
        return RECORDER.read_text(encoding='utf-8')

    def test_it_refuses_a_backup_with_no_manifest(self, script):
        assert 'Refusing to record a backup with no sha256 manifest' in script

    def test_it_refuses_a_backup_with_no_artifacts(self, script):
        assert 'Refusing to record a backup with no artifacts' in script

    def test_it_reuses_the_backend_env_rather_than_prompting(self, script):
        assert 'SUPABASE_URL' in script and 'SUPABASE_KEY' in script
        assert 'Read-Host' not in script

    def test_it_rejects_a_placeholder_service_key(self, script):
        assert "match '^your-'" in script

    def test_it_sends_no_paths_or_hostnames(self, script):
        body = script.split('$body = @{')[1].split('} | ConvertTo-Json')[0]
        assert 'BackupDirectory' not in body
        assert 'COMPUTERNAME' not in body
        assert 'p_host_fingerprint' in body

    def test_the_machine_fingerprint_is_hashed_and_truncated(self, script):
        assert 'SHA256' in script
        assert 'Substring(0, 16)' in script

    def test_it_clears_the_service_key_afterwards(self, script):
        assert '$plainServiceKey = $null' in script


class TestTheSchedulerRecordsSuccessfulRuns:
    @pytest.fixture(name='script')
    def script_fixture(self):
        return SCHEDULER.read_text(encoding='utf-8')

    def test_it_calls_the_recorder(self, script):
        assert 'record_backup_run.ps1' in script

    def test_recording_failure_cannot_fail_a_successful_backup(self, script):
        recording = script.split('if (-not $SkipRecording)')[1].split('if ($KeepLast')[0]
        assert 'try {' in recording and 'catch {' in recording
        assert 'Write-Warning' in recording
        assert 'throw' not in recording

    def test_it_records_only_after_the_manifest_check(self, script):
        assert script.index('sha256-manifest.json') < script.index('record_backup_run.ps1')

    def test_a_rehearsal_can_skip_recording(self, script):
        assert '[switch]$SkipRecording' in script


class TestTheDrillDocumentIsHonest:
    @pytest.fixture(name='doc')
    def doc_fixture(self):
        return DRILL_DOC.read_text(encoding='utf-8')

    def test_it_declares_both_targets(self, doc):
        assert 'BACKUP_RPO_HOURS' in doc and 'BACKUP_RTO_HOURS' in doc
        assert '24 hours' in doc and '4 hours' in doc

    def test_it_does_not_claim_a_drill_has_been_run(self, doc):
        assert '_(pending)_' in doc
        assert 'First drill not yet run' in doc

    def test_it_lists_the_operator_steps_that_remain(self, doc):
        for step in ('passphrase file', 'nightly task', 'restore drill'):
            assert step in doc

    def test_it_tells_the_operator_to_test_the_alarm(self, doc):
        assert 'Testing the alarm is part of installing it' in doc

    def test_the_declared_rto_matches_the_configured_default(self, doc):
        assert f'**{settings.backup_rto_hours} hours**' in doc
