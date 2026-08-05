"""Keep the README true.

Five claims in it were stale on 2026-08-04, and two of them mattered: the
fresh-project setup omitted seven tables that exist only in migrations, and the
Objective 2 section named Faithfulness and Context Precision as the
baseline-versus-RAG metrics when the code compares Answer Correctness and treats
the other two as RAG-only diagnostics.

Nobody notices a stale README until someone follows it. These tests assert the
facts rather than the phrasing, so the prose can be rewritten freely and only a
genuine divergence fails.
"""

import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
README = ROOT / 'README.md'


def readme_text() -> str:
    return README.read_text(encoding='utf-8')


def migration_files() -> list[pathlib.Path]:
    return sorted(
        path for path in (BACKEND / 'migrations').glob('*.sql')
        if '.rollback.' not in path.name
    )


def tables_only_in_migrations() -> dict[str, str]:
    """Table -> the migration that introduces it, for tables the base schema lacks."""
    base = (BACKEND / 'supabase_setup.sql').read_text(encoding='utf-8')
    found: dict[str, str] = {}
    for path in migration_files():
        text = path.read_text(encoding='utf-8')
        for match in re.finditer(r'create table if not exists public\.(\w+)', text, re.I):
            found.setdefault(match.group(1), path.name)
    return {
        table: source for table, source in found.items()
        if f'create table if not exists public.{table}' not in base
    }


class TestTheReadmeExistsAndIsParsed:
    """Guard the guards: a bad path would make every check below vacuous."""

    def test_readme_is_present_and_substantial(self):
        assert README.is_file()
        assert len(readme_text()) > 3000

    def test_migrations_are_discovered(self):
        assert len(migration_files()) >= 10


class TestFreshProjectSetupIsComplete:
    """`supabase_setup.sql` alone leaves a deployment that looks fine and has a
    broken operations console."""

    def test_the_base_schema_really_is_insufficient(self):
        assert tables_only_in_migrations(), (
            'no migration-only tables found - the parser is probably broken, '
            'which would make the README check below meaningless'
        )

    def test_every_migration_only_table_is_named_in_the_readme(self):
        text = readme_text()
        missing = [
            table for table in tables_only_in_migrations()
            if f'`{table}`' not in text
        ]
        assert not missing, (
            'these tables exist only in migrations but the README does not warn '
            f'about them: {sorted(missing)}'
        )

    def test_the_readme_does_not_claim_one_migration_suffices(self):
        text = readme_text()
        assert 'then apply `20260725_normalized_academic_catalog.sql`.' not in text, (
            'the README still tells a fresh project to apply a single migration'
        )

    def test_upload_jobs_is_in_the_base_schema(self):
        """20260723 ALTERs upload_jobs, so the base schema must create it or a
        fresh project cannot apply the migrations in order at all."""
        base = (BACKEND / 'supabase_setup.sql').read_text(encoding='utf-8')
        assert 'create table if not exists public.upload_jobs' in base


class TestObjectiveTwoMetricsAreDescribedCorrectly:
    """Faithfulness and Context Precision are RAG-only. A baseline with no
    retriever has no retrieved contexts to score, so naming them as the
    comparison metrics misstates the study."""

    @pytest.fixture(name='comparison')
    def comparison_fixture(self):
        return (BACKEND / 'evaluation' / 'run_comparison.py').read_text(encoding='utf-8')

    def test_the_baseline_is_scored_only_on_answer_correctness(self, comparison):
        assert "baseline_scores.append({'answer_correctness'" in comparison

    def test_no_baseline_faithfulness_or_context_precision_is_computed(self, comparison):
        assert 'baseline_faithfulness' not in comparison
        assert 'baseline_context_precision' not in comparison

    def test_the_readme_names_answer_correctness(self):
        assert 'Answer Correctness' in readme_text()


class TestReferencedFilesExist:
    def test_every_relative_link_resolves(self):
        broken = [
            target for target in sorted(set(
                re.findall(r'\]\((?!https?://)([^)#]+)\)', readme_text())
            ))
            if not (ROOT / target).exists()
        ]
        assert not broken, f'README links to files that do not exist: {broken}'

    @pytest.mark.parametrize('plan', [
        'provider_independent_load.jmx', 'chat_load.jmx',
        'rate_limit_test.jmx', 'live_gemini_smoke.jmx',
    ])
    def test_every_jmeter_plan_the_readme_lists_exists(self, plan):
        assert (BACKEND / 'jmeter' / plan).is_file()
        assert plan in readme_text()

    def test_the_readme_does_not_direct_readers_to_the_superseded_plan(self):
        """thesis_load_test.jmx is retained as history; the ISO evidence calls it
        legacy, so it must not be the plan a reader is told to run."""
        assert 'Open jmeter/thesis_load_test.jmx' not in readme_text()

    def test_the_summarizers_it_mentions_exist(self):
        assert (BACKEND / 'evaluation' / 'summarize_jmeter.py').is_file()
        assert (BACKEND / 'evaluation' / 'summarize_chat_load.py').is_file()


class TestFrontendCommandsResolve:
    @pytest.mark.parametrize('script', ['lint', 'test:coverage', 'build', 'bundle:budget'])
    def test_npm_scripts_the_readme_invokes_exist(self, script):
        import json
        package = json.loads(
            (ROOT / 'rag-thesis-frontend' / 'package.json').read_text(encoding='utf-8')
        )
        assert script in package['scripts']
        assert f'npm run {script}' in readme_text()


class TestFrontendReadmeMatchesTheFrontend:
    """Three claims in it were wrong on 2026-08-04: a transposed npm version,
    the wrong number of lazy-loaded admin tabs, and two CI-gated scripts that
    were not documented at all."""

    @pytest.fixture(name='frontend_readme')
    def frontend_readme_fixture(self):
        return (ROOT / 'rag-thesis-frontend' / 'README.md').read_text(encoding='utf-8')

    @pytest.fixture(name='package')
    def package_fixture(self):
        import json
        return json.loads(
            (ROOT / 'rag-thesis-frontend' / 'package.json').read_text(encoding='utf-8')
        )

    def test_the_npm_version_matches_package_json(self, frontend_readme, package):
        declared = package['packageManager'].split('@')[1]
        assert declared in frontend_readme, (
            f'package.json pins npm {declared}; the frontend README does not say so'
        )

    def test_the_admin_tab_count_matches_the_router(self, frontend_readme):
        admin = (ROOT / 'rag-thesis-frontend' / 'src' / 'pages' / 'Admin.jsx').read_text(
            encoding='utf-8')
        tabs = re.findall(r"lazy\(\(\) => import\('\./admin/", admin)
        words = {3: 'three', 4: 'four', 5: 'five'}
        assert len(tabs) in words, f'unexpected admin tab count: {len(tabs)}'
        assert f'{words[len(tabs)]} Admin tabs' in frontend_readme, (
            f'Admin.jsx lazy-loads {len(tabs)} tabs; the README says otherwise'
        )

    @pytest.mark.parametrize('script', ['test:coverage', 'bundle:budget'])
    def test_ci_gated_scripts_are_documented(self, frontend_readme, package, script):
        assert script in package['scripts']
        assert script in frontend_readme, (
            f'{script} is a CI gate but the frontend README does not mention it'
        )


class TestJmeterReadmeIsRunnable:
    """Its documented command did not work on Windows, and it pointed `/chat`
    runs at a summarizer that conflates capacity notices with real answers."""

    @pytest.fixture(name='jmeter_readme')
    def jmeter_readme_fixture(self):
        return (BACKEND / 'jmeter' / 'README.md').read_text(encoding='utf-8')

    def test_it_invokes_the_jar_not_the_batch_launcher(self, jmeter_readme):
        assert 'ApacheJMeter.jar' in jmeter_readme
        assert not re.search(r'^\s*jmeter -n -t', jmeter_readme, re.M), (
            'jmeter.bat mangles -J properties and ends with a pause; the README '
            'must not tell a reader to use it'
        )

    def test_chat_runs_are_pointed_at_the_right_summarizer(self, jmeter_readme):
        assert (BACKEND / 'evaluation' / 'summarize_chat_load.py').is_file()
        marker = '## `/chat` runs need a different summarizer'
        assert marker in jmeter_readme
        chat_section = jmeter_readme.split(marker)[1]
        assert 'summarize_chat_load' in chat_section
        assert 'summarize_jmeter evaluation' not in chat_section, (
            'a /chat run can report 100% HTTP 200 while answering almost nothing'
        )

    def test_the_superseded_plan_is_marked_as_such(self, jmeter_readme):
        assert 'thesis_load_test.jmx' in jmeter_readme
        assert 'superseded' in jmeter_readme


class TestEvidenceFiguresAreNotStale:
    """The dated revalidation table drifted twice. These assert internal
    consistency rather than pinning numbers that legitimately change."""

    @pytest.fixture(name='evidence')
    def evidence_fixture(self):
        return (BACKEND / 'evaluation' / 'iso25010_evidence.md').read_text(encoding='utf-8')

    def test_superseded_figures_are_not_left_in_the_current_table(self, evidence):
        current = evidence.split('## Archived evidence snapshot')[0]
        for stale in ('539 passed', '91.28% coverage', '44/44 passed',
                      '25 advisory `heading-order` findings remain open'):
            assert stale not in current, (
                f'the current revalidation table still reports {stale!r}'
            )

    def test_it_states_how_the_backend_count_was_taken(self, evidence):
        """643 vs 645 depends on whether the live disposable-project checks ran,
        so the table has to say which convention it used."""
        assert 'ALLOW_DISPOSABLE_SUPABASE_TESTS' in evidence


class TestSonarQubeVersionIsHonest:
    """The paper records 10.4; the retained evidence was produced on a different
    build. The README must not quietly assert the paper's number."""

    def test_the_readme_states_the_build_that_produced_the_evidence(self):
        evidence = (BACKEND / 'evaluation' / 'iso25010_evidence.md').read_text(encoding='utf-8')
        assert '26.7.0.124771' in evidence
        assert '26.7.0.124771' in readme_text()

    def test_the_readme_does_not_pin_an_image_that_was_never_used(self):
        assert 'sonarqube:10.4-community' not in readme_text()

    def test_both_coverage_report_paths_are_configured(self):
        props = (ROOT / 'sonar-project.properties').read_text(encoding='utf-8')
        assert 'sonar.python.coverage.reportPaths' in props
        assert 'sonar.javascript.lcov.reportPaths' in props
