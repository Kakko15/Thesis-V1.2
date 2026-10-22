"""The thesis adviser: captured at upload, stored on the paper, served to the archive.

Added with migrations/20260923_paper_adviser.sql. The adviser travels in the
upload request payload, a BEFORE INSERT trigger copies it onto the paper, and
GET /papers serves it to the Thesis Library. It is read off the manuscript's
front matter locally and never asked of the model, and it never reaches
retrieval, so the frozen evaluated pipeline is untouched.
"""

import asyncio
import inspect
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models import BatchRow, PaperOut
from routers import papers, upload
from services import front_matter, ingestion
from .test_durable_ingestion import (
    BatchClient,
    IDEMPOTENCY_KEY,
    JOB_ID,
    KEY_A,
    KEY_B,
    OWNER_ID,
    PipelineClient,
    UploadClient,
    claimed_job,
    patch_pipeline,
    pdf_bytes,
    upload_file,
)
from .test_router_error_paths import (  # noqa: F401 - upload_client is a fixture
    FRONT_MATTER,
    _TableRouter,
    _pdf_bytes,
    _pdf_pages,
    upload_client,
)

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / 'migrations' / '20260923_paper_adviser.sql'
ROLLBACK = BACKEND / 'migrations' / '20260923_paper_adviser.rollback.sql'

# Long enough to clear _ABSTRACT_MIN_CHARS, so the heading above it is accepted
# as the manuscript's abstract. Wrapped at a justified page's width: PyMuPDF
# clips a line drawn past the page edge, and the endpoint tests build real
# PDFs. Lines under 60 characters would instead read as the wrapped value of
# the identity label above them (_is_wrapped_label_value).
PROSE = '\n'.join((
    'This study developed a web-based archive for undergraduate research that indexes',
    'manuscripts and supports retrieval of prior work by topic, author and year. It was',
    'evaluated with faculty and students across the five programs of the college, who',
    'found the retrieval accurate and the interface easy to use in daily research work.',
))


def _abstract_page(*identity: str) -> str:
    return '\n'.join(('ABSTRACT', *identity, '', PROSE))


def _unclassified(*_args, **_kwargs):
    return SimpleNamespace(as_payload=lambda: {
        'department_id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'program_id': None, 'specialization_id': None, 'track': '',
        'legacy_track': None, 'classification_status': 'unclassified',
    })


class TestMigration:
    def test_adds_a_nullable_column_and_its_own_hydrate_trigger(self):
        sql = MIGRATION.read_text(encoding='utf-8')
        assert 'alter table public.papers add column if not exists adviser text;' in sql
        assert "new.adviser := coalesce(nullif(btrim(v_payload ->> 'adviser'), ''), new.adviser);" in sql
        assert 'create trigger a_papers_hydrate_adviser before insert on public.papers' in sql

    def test_redefines_no_existing_function(self):
        """Retrieval and ingestion stay frozen: only the new trigger function is defined.

        Editing hydrate_paper_academic_classification instead would have added
        a third copy to its chain, and replaying 20260819 would then silently
        stop hydrating the adviser.
        """
        sql = MIGRATION.read_text(encoding='utf-8')
        defined = re.findall(r'create or replace function public\.(\w+)', sql)
        assert defined == ['hydrate_paper_adviser']

    def test_upload_jobs_gains_no_mirror_column(self):
        sql = MIGRATION.read_text(encoding='utf-8')
        assert 'alter table public.upload_jobs' not in sql

    def test_rollback_drops_the_trigger_the_function_and_the_column(self):
        sql = ROLLBACK.read_text(encoding='utf-8')
        assert 'drop trigger if exists a_papers_hydrate_adviser on public.papers;' in sql
        assert 'drop function if exists public.hydrate_paper_adviser();' in sql
        assert 'alter table public.papers drop column if exists adviser;' in sql

    def test_base_schema_mirrors_the_column(self):
        base = (BACKEND / 'supabase_setup.sql').read_text(encoding='utf-8')
        assert 'alter table public.papers add column if not exists adviser text;' in base


class TestValidation:
    def test_two_hundred_characters_pass_and_two_hundred_and_one_are_refused(self):
        upload._validate_metadata('A valid thesis title', '', '2026', '', adviser='A' * 200)
        with pytest.raises(HTTPException) as caught:
            upload._validate_metadata('A valid thesis title', '', '2026', '', adviser='A' * 201)
        assert caught.value.status_code == 422
        assert 'Adviser' in caught.value.detail

    def test_the_four_argument_form_still_validates(self):
        upload._validate_metadata('A valid thesis title', 'Ana Cruz', '2026', 'Short abstract')


class TestUploadPayload:
    @pytest.fixture(autouse=True)
    def catalog(self, monkeypatch):
        monkeypatch.setattr(upload, 'resolve_academic_selection', _unclassified)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)

    @staticmethod
    def _upload(client, **form):
        endpoint = inspect.unwrap(upload.upload_paper)
        asyncio.run(endpoint(
            request=SimpleNamespace(), file=upload_file(), title='Durable Thesis Library',
            authors='', year='', abstract='', track='', department='CCSICT',
            idempotency_key=IDEMPOTENCY_KEY, user=SimpleNamespace(id=OWNER_ID), **form,
        ))
        return client.rpc_payloads['reserve_upload_job']['p_request_payload']

    def test_the_adviser_is_carried_whitespace_collapsed(self, monkeypatch):
        client = UploadClient()
        monkeypatch.setattr(upload, 'sb', client)
        payload = self._upload(client, adviser='  Dr.   Ana  D. Cruz \n')
        assert payload['adviser'] == 'Dr. Ana D. Cruz'

    def test_an_omitted_adviser_is_an_empty_key_not_a_missing_one(self, monkeypatch):
        client = UploadClient()
        monkeypatch.setattr(upload, 'sb', client)
        assert self._upload(client)['adviser'] == ''

    def test_an_oversized_adviser_is_refused_before_anything_is_staged(self, monkeypatch):
        client = UploadClient()
        monkeypatch.setattr(upload, 'sb', client)
        with pytest.raises(HTTPException) as caught:
            self._upload(client, adviser='A' * 201)
        assert caught.value.status_code == 422
        assert 'reserve_upload_job' not in client.rpc_payloads


class TestBatchPayload:
    @pytest.fixture(autouse=True)
    def catalog(self, monkeypatch):
        monkeypatch.setattr(upload, 'resolve_academic_selection', _unclassified)
        monkeypatch.setattr(upload, 'resolve_effective_department', lambda _user, value: value)

    @staticmethod
    def _call(files, rows):
        endpoint = inspect.unwrap(upload.upload_batch)
        return asyncio.run(endpoint(
            request=SimpleNamespace(), user=SimpleNamespace(id=OWNER_ID),
            files=files, rows=json.dumps(rows), department='CCSICT',
        ))

    def test_each_row_carries_its_own_adviser_and_a_long_one_rejects_only_that_row(self, monkeypatch):
        client = BatchClient()
        monkeypatch.setattr(upload, 'sb', client)
        response = self._call([upload_file(), upload_file()], [
            {'title': 'First Durable Thesis', 'adviser': 'Dr. Ana Cruz', 'idempotency_key': KEY_A},
            {'title': 'Second Durable Thesis', 'adviser': 'A' * 201, 'idempotency_key': KEY_B},
        ])
        assert (response.accepted, response.rejected) == (1, 1)
        assert response.results[1].status_code == 422
        assert [reserve['p_request_payload']['adviser'] for reserve in client.reserves] == [
            'Dr. Ana Cruz',
        ]

    def test_a_row_from_a_client_that_predates_the_field_still_parses(self):
        row = BatchRow(title='A Thesis Title', idempotency_key=KEY_A)
        assert row.adviser == ''


class TestArchiveListing:
    class _Query:
        def __init__(self, fields_log, fail_for):
            self.fields_log = fields_log
            self.fail_for = fail_for
            self.fields = ''

        def select(self, fields):
            self.fields = fields
            self.fields_log.append(fields)
            return self

        def eq(self, *_args):
            return self

        def in_(self, *_args):
            return self

        def order(self, *_args, **_kwargs):
            return self

        def execute(self):
            error = self.fail_for(self.fields)
            if error:
                raise error
            return SimpleNamespace(data=[{
                'id': 'p1', 'title': 'Archived thesis', 'created_at': '2026-01-01',
                'adviser': 'Dr. Ana Cruz' if 'adviser' in self.fields else None,
                'thesis_category': 'faculty' if 'thesis_category' in self.fields else None,
            }])

    def _client(self, fail_for):
        fields_log = []
        outer = self

        class Client:
            def table(self, name):
                if name == 'profiles':
                    return SimpleNamespace(
                        select=lambda *_a: SimpleNamespace(eq=lambda *_b: SimpleNamespace(
                            execute=lambda: SimpleNamespace(data=[{'role': 'admin', 'department': 'CCSICT'}]),
                        )),
                    )
                return outer._Query(fields_log, fail_for)
        return Client(), fields_log

    def test_the_archive_selects_the_adviser(self, monkeypatch):
        client, fields_log = self._client(lambda _fields: None)
        monkeypatch.setattr(papers, 'sb', client)
        rows = papers.list_papers(user=SimpleNamespace(id='admin'))
        assert fields_log[0].endswith(',adviser')
        assert rows[0]['adviser'] == 'Dr. Ana Cruz'
        assert PaperOut(**rows[0]).adviser == 'Dr. Ana Cruz'

    def test_a_missing_adviser_column_keeps_the_normalized_fields(self, monkeypatch):
        """Without its own tier, one optional column would cost thesis_category."""
        def fail_for(fields):
            if 'adviser' in fields:
                return RuntimeError('column papers.adviser does not exist')
            return None
        client, fields_log = self._client(fail_for)
        monkeypatch.setattr(papers, 'sb', client)
        rows = papers.list_papers(user=SimpleNamespace(id='admin'))
        assert len(fields_log) == 2
        assert 'thesis_category' in fields_log[1] and 'adviser' not in fields_log[1]
        assert rows[0]['thesis_category'] == 'faculty'

    def test_any_other_failure_still_reaches_the_legacy_fields(self, monkeypatch):
        def fail_for(fields):
            return RuntimeError('connection reset') if 'program_id' in fields else None
        client, fields_log = self._client(fail_for)
        monkeypatch.setattr(papers, 'sb', client)
        papers.list_papers(user=SimpleNamespace(id='admin'))
        assert len(fields_log) == 2
        assert 'program_id' not in fields_log[1]

    def test_a_paper_without_an_adviser_serializes_as_null(self):
        assert PaperOut(id='p1', title='Legacy thesis', created_at='2026-01-01').adviser is None


class TestIngestionPayload:
    def test_the_committed_paper_payload_documents_the_adviser(self, monkeypatch):
        content = pdf_bytes()
        client = PipelineClient(content)
        patch_pipeline(monkeypatch)
        job = claimed_job(content)
        job['request_payload']['adviser'] = ' Dr. Ana Cruz '
        ingestion.process_ingestion_job(client, job, 'worker-1', lambda **_kw: True)
        name, payload = client.rpc_calls[-1]
        assert name == 'commit_upload_ingestion' and payload['p_job_id'] == JOB_ID
        assert payload['p_paper']['adviser'] == 'Dr. Ana Cruz'

    def test_a_payload_without_the_key_commits_null(self, monkeypatch):
        content = pdf_bytes()
        client = PipelineClient(content)
        patch_pipeline(monkeypatch)
        ingestion.process_ingestion_job(client, claimed_job(content), 'worker-1', lambda **_kw: True)
        assert client.rpc_calls[-1][1]['p_paper']['adviser'] is None


class _RecordingPapers:
    """The `papers` table as the post-commit adviser fill uses it."""

    def __init__(self, writes, error):
        self.writes = writes
        self.error = error
        self.payload = None
        self.filters = []

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append(('eq', column, value))
        return self

    def is_(self, column, value):
        self.filters.append(('is', column, value))
        return self

    def execute(self):
        if self.error:
            raise self.error
        self.writes.append((self.payload, self.filters))
        return SimpleNamespace(data=[])


class _AdviserPipelineClient(PipelineClient):
    def __init__(self, content, *, write_error=None):
        super().__init__(content)
        self.paper_writes = []
        self.write_error = write_error

    def table(self, name):
        if name == 'papers':
            return _RecordingPapers(self.paper_writes, self.write_error)
        return super().table(name)


class TestWorkerFillsABlankAdviser:
    """Automatic at ingestion: a paper uploaded without an adviser gets the PDF's."""

    MANUSCRIPT = _pdf_pages([
        'A DOCUMENT TRACKING SYSTEM\nBy:\nAna D. Cruz',
        _abstract_page('Title: A Document Tracking System', 'Adviser: Inst. Jenefer P. Bermusa, MIT'),
    ])

    def _ingest(self, monkeypatch, content, *, adviser='', write_error=None):
        client = _AdviserPipelineClient(content, write_error=write_error)
        patch_pipeline(monkeypatch)
        job = claimed_job(content)
        job['request_payload']['adviser'] = adviser
        paper_id = ingestion.process_ingestion_job(client, job, 'worker-1', lambda **_kw: True)
        return client, paper_id

    def test_a_blank_upload_adviser_is_read_off_the_manuscript_after_commit(self, monkeypatch):
        client, paper_id = self._ingest(monkeypatch, self.MANUSCRIPT)
        assert paper_id == JOB_ID
        assert client.paper_writes == [(
            {'adviser': 'Inst. Jenefer P. Bermusa, MIT'},
            [('eq', 'id', JOB_ID), ('is', 'adviser', 'null')],
        )]
        # Only after the paper row exists: the commit is the last RPC.
        assert client.rpc_calls[-1][0] == 'commit_upload_ingestion'

    def test_the_uploaders_own_adviser_is_never_second_guessed(self, monkeypatch):
        client, _paper_id = self._ingest(monkeypatch, self.MANUSCRIPT, adviser='Dr. Typed By Hand')
        assert client.paper_writes == []

    def test_a_manuscript_naming_no_adviser_writes_nothing(self, monkeypatch):
        client, _paper_id = self._ingest(monkeypatch, pdf_bytes())
        assert client.paper_writes == []

    def test_a_failed_write_never_fails_the_committed_ingestion(self, monkeypatch):
        client, paper_id = self._ingest(
            monkeypatch, self.MANUSCRIPT, write_error=RuntimeError('connection reset'),
        )
        assert paper_id == JOB_ID
        assert client.paper_writes == []

    def test_an_unreadable_manuscript_is_reported_as_nothing_found(self):
        client = _AdviserPipelineClient(b'')
        assert ingestion.fill_adviser_from_manuscript(client, JOB_ID, b'not a pdf') == ''
        assert client.paper_writes == []


class TestAdviserExtraction:
    """`_extract_adviser`: three places the front matter names the adviser, in order of trust."""

    def test_the_abstract_identity_block_keeps_credentials_verbatim(self):
        """', MIT' is the adviser's degree. _normalize_author would read the
        comma as 'Surname, Given' and reorder the name around it."""
        pages = ['TITLE PAGE', _abstract_page('Title: X System', 'Adviser: Inst. Jenefer P. Bermusa, MIT')]
        assert front_matter.adviser_with_source(pages) == (
            'Inst. Jenefer P. Bermusa, MIT', 'abstract identity block',
        )

    def test_a_co_adviser_alone_is_not_the_adviser(self):
        assert front_matter.extract_adviser([_abstract_page('Co-Adviser : Dr. Ana D. Cruz')]) == ''

    def test_a_wrapped_identity_value_is_joined(self):
        pages = [_abstract_page('Title: X', 'Adviser: Dr. Maria', 'Santos Reyes')]
        assert front_matter.extract_adviser(pages) == 'Dr. Maria Santos Reyes'

    def test_two_different_identity_advisers_are_ambiguous(self):
        pages = [_abstract_page('Adviser: Dr. Ana Cruz', 'Adviser: Dr. Ben Diaz')]
        assert front_matter.extract_adviser(pages) == ''

    def test_a_labelled_line_on_the_title_page(self):
        pages = ['A THESIS\nThesis Adviser: Engr. Carlo M. Ramos', _abstract_page()]
        assert front_matter.adviser_with_source(pages) == ('Engr. Carlo M. Ramos', 'labelled line')

    def test_a_blank_signature_line_is_no_adviser(self):
        assert front_matter.extract_adviser(['Adviser: ______________', _abstract_page()]) == ''

    def test_a_second_label_merged_onto_the_line_is_cut_away(self):
        pages = ['Adviser: Dr. A. Cruz Co-Adviser: Engr. B. Diaz', _abstract_page()]
        assert front_matter.extract_adviser(pages) == 'Dr. A. Cruz'

    def test_a_role_word_after_the_label_is_not_a_name(self):
        assert front_matter.extract_adviser(['Adviser-Critic: Dr. X Santos', _abstract_page()]) == ''

    def test_the_approval_sheet_stack_is_read_and_recased(self):
        sheet = (
            'APPROVAL SHEET\nThis thesis is hereby recommended for approval.\n'
            'JENEFER P. BERMUSA, MIT\nAdviser\nDR. JUAN SANTOS\nDean, CCSICT'
        )
        assert front_matter.adviser_with_source([sheet, _abstract_page()]) == (
            'Jenefer P. Bermusa, MIT', 'signature block',
        )

    def test_side_by_side_signature_blocks_are_refused(self):
        """Read naively, the co-adviser's name sits directly above 'Adviser'."""
        sheet = 'APPROVAL SHEET\nrecommended for approval\nANA CRUZ\nBEN DIAZ\nAdviser\nCo-Adviser'
        assert front_matter.extract_adviser([sheet, _abstract_page()]) == ''

    def test_a_label_printed_above_its_name_is_refused(self):
        sheet = 'PANEL OF EXAMINERS\nChairman\nDR. B SANTOS\nAdviser\nDR. A CRUZ'
        assert front_matter.extract_adviser([sheet, _abstract_page()]) == ''

    def test_a_bare_role_line_off_the_approval_sheet_is_ignored(self):
        assert front_matter.extract_adviser(['JUAN CRUZ\nAdviser', _abstract_page()]) == ''

    def test_the_acknowledgment_names_no_adviser(self):
        assert front_matter.extract_adviser(FRONT_MATTER) == ''

    def test_the_chapters_past_the_abstract_page_are_not_searched(self):
        """A thesis about an advising workflow may print 'Adviser - the user who ...'."""
        pages = [_abstract_page(), 'CHAPTER 1\nAdviser: Dr. Wrong Person']
        assert front_matter.extract_adviser(pages) == ''

    def test_without_an_abstract_the_whole_window_is_searched(self):
        assert front_matter.extract_adviser(['A THESIS', 'Adviser - Dr. Ana Cruz']) == 'Dr. Ana Cruz'

    # The layouts below are the CCSICT templates the 2026-09-23 backfill dry run
    # met in the live archive, with the names changed.

    def test_an_identity_table_split_across_lines(self):
        """Extracted column by column: the separator and value follow the label."""
        page = '\n'.join((
            'ABSTRACT', 'Title', ': An Alumni Tracer Platform', 'Adviser',
            ': Romero D. Salum, DIT', PROSE,
        ))
        assert front_matter.adviser_with_source([page]) == ('Romero D. Salum, DIT', 'labelled line')

    def test_the_advisory_committee_lists_the_research_project_adviser(self):
        sheet = '\n'.join((
            'requirements for the degree ... and is hereby endorsed.',
            'ADVISORY COMMITTEE', 'RUBY A. SANTOS, RL, MLIS', 'Research Project Adviser',
            'PANEL COMMITTEE', 'ANA B. REYES, DIT', 'JOSE C. LIM, Ph.D', 'Panel', 'Panel',
            'LUZ D. CRUZ, RL, Ph.D', 'Panel Chair',
            'Approved and accepted as a partial fulfillment of the requirements.',
            'RITA E. VALDEZ, DIT', 'Dean, CCSICT', 'Date',
        ))
        assert front_matter.adviser_with_source([sheet, _abstract_page()]) == (
            'Ruby A. Santos, RL, MLIS', 'signature block',
        )

    def test_role_labels_extracted_below_every_name_never_name_the_dean(self):
        """Here the name directly above 'Project Adviser' is the dean's.

        The signature stack refuses the page for that reason, and the advisory
        committee heading is what still names the real adviser.
        """
        sheet = '\n'.join((
            'Management for Business Process Outsourcing (BPO) is hereby endorsed.',
            'ADVISORY COMMITTEE', 'MARIO A. SANTOS, DIT', 'PANEL COMMITTEE',
            'ANA B. REYES, MSIT', 'JOSE C. LIM, MSIT',
            'Approved and accepted as a partial fulfilment of the requirements.',
            'LUZ D. CRUZ, MSIT', '_______________', 'RITA E. VALDEZ, DIT', '_______________',
            'Project Adviser', 'Content Panel', 'Technical Panel', 'Panel Chair',
            'BSIS Program Chairperson', 'Dean, CCSICT', 'Date', 'Date',
        ))
        assert front_matter.extract_adviser([sheet, _abstract_page()]) == 'Mario A. Santos, DIT'

    def test_two_names_on_the_advisory_committee_give_no_answer(self):
        sheet = 'hereby endorsed.\nADVISORY COMMITTEE\nMARIO A. SANTOS, DIT\nANA B. REYES, DIT\nPANEL COMMITTEE'
        assert front_matter.extract_adviser([sheet, _abstract_page()]) == ''

    def test_committee_and_stack_that_disagree_give_no_answer(self):
        sheet = '\n'.join((
            'hereby endorsed.', 'ADVISORY COMMITTEE', 'MARIO A. SANTOS, DIT', 'PANEL COMMITTEE',
            'ANA B. REYES, DIT', 'Adviser',
        ))
        assert front_matter.extract_adviser([sheet, _abstract_page()]) == ''

    def test_the_capstone_title_page_signature_block(self):
        title_page = '\n'.join((
            'A Document Tracking System', 'By:', 'Cruz, Ana', 'Reyes, Ben',
            '___________________', 'Desiray D. Nayga, DIT', 'Project Adviser', '2025',
        ))
        assert front_matter.adviser_with_source([title_page, _abstract_page()]) == (
            'Desiray D. Nayga, DIT', 'signature block',
        )

    def test_a_title_page_role_line_without_its_signature_rule_is_ignored(self):
        title_page = 'A Document Tracking System\nBy:\nCruz, Ana\nDesiray D. Nayga, DIT\nProject Adviser'
        assert front_matter.extract_adviser([title_page, _abstract_page()]) == ''

    def test_name_shape(self):
        assert front_matter.adviser_name('Ma. Teresa Peñaflor') == 'Ma. Teresa Peñaflor'
        assert front_matter.adviser_name('DR. ANA D. CRUZ, PhD') == 'Dr. Ana D. Cruz, PhD'
        assert front_matter.adviser_name('Rosa dela Cruz') == 'Rosa dela Cruz'
        assert front_matter.adviser_name('the user who reviews') == ''
        assert front_matter.adviser_name('Bermusa, MIT') == ''
        assert front_matter.adviser_name('Room 204 Annex') == ''
        assert front_matter.adviser_name('Approved by the Panel') == ''


class TestExtractionEndpoints:
    ADVISER_PAGE = _abstract_page('Title: An Intelligent Archive', 'Adviser: Inst. Jenefer P. Bermusa, MIT')

    def test_the_single_upload_autofill_returns_the_adviser_without_a_model_call(
        self, upload_client, monkeypatch,
    ):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))

        def forbidden(*_args, **_kwargs):
            raise AssertionError('the adviser must never be asked of the model')
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', forbidden)
        title_page = (
            'AN INTELLIGENT ARCHIVE PLATFORM FOR RESEARCH\nCCSICT\nBy:\nAna D. Cruz\nMay 2026'
        )
        pdf = _pdf_pages([title_page, 'APPROVAL SHEET', 'CONTENTS', self.ADVISER_PAGE])
        response = upload_client.post(
            '/upload/extract-metadata', files={'file': ('thesis.pdf', pdf, 'application/pdf')},
        )
        assert response.status_code == 200
        assert response.json()['adviser'] == 'Inst. Jenefer P. Bermusa, MIT'

    def test_the_batch_autofill_reads_past_the_title_pages_for_the_adviser(
        self, upload_client, monkeypatch,
    ):
        """Page four: only reachable because batch now reads the same twelve pages."""
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', lambda **_kwargs: object())

        async def arun(_llm, _slot, _call):
            return SimpleNamespace(content='{"title": "Completed By Model"}')
        monkeypatch.setattr(upload.gemini_pool, 'arun', arun)
        pdf = _pdf_pages(['Cover', 'Approval', 'Contents', self.ADVISER_PAGE])
        response = upload_client.post(
            '/upload/batch/extract-metadata',
            files=[('files', ('thesis.pdf', pdf, 'application/pdf'))],
        )
        assert response.status_code == 200
        entry = response.json()['files'][0]
        # Survives the model completion, which answers the four model fields only.
        assert entry['title'] == 'Completed By Model'
        assert entry['adviser'] == 'Inst. Jenefer P. Bermusa, MIT'
        assert 'abstract' not in entry

    def test_the_adviser_survives_a_failed_completion(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', lambda **_kwargs: object())

        async def arun(_llm, _slot, _call):
            raise RuntimeError('provider down')
        monkeypatch.setattr(upload.gemini_pool, 'arun', arun)
        pdf = _pdf_pages(['Cover', 'Approval', 'Contents', self.ADVISER_PAGE])
        response = upload_client.post(
            '/upload/extract-metadata', files={'file': ('thesis.pdf', pdf, 'application/pdf')},
        )
        assert response.status_code == 200
        assert response.json()['adviser'] == 'Inst. Jenefer P. Bermusa, MIT'

    def test_a_manuscript_naming_no_adviser_autofills_blank(self, upload_client, monkeypatch):
        monkeypatch.setattr(upload, 'sb', _TableRouter({'departments': [{'name': 'CCSICT'}]}))
        monkeypatch.setattr(upload, 'ChatGoogleGenerativeAI', lambda **_kwargs: object())

        async def arun(_llm, _slot, _call):
            return SimpleNamespace(content='{}')
        monkeypatch.setattr(upload.gemini_pool, 'arun', arun)
        response = upload_client.post(
            '/upload/batch/extract-metadata',
            files=[('files', ('thesis.pdf', _pdf_bytes(('A cover line',)), 'application/pdf'))],
        )
        assert response.json()['files'][0]['adviser'] == ''


def test_validation_error_message_names_every_row_field():
    with pytest.raises(HTTPException) as caught:
        upload._parse_batch_rows('not json', expected=1)
    assert 'adviser' in caught.value.detail


def test_batch_row_adviser_must_be_text():
    with pytest.raises(ValidationError):
        BatchRow(title='A Thesis Title', idempotency_key=KEY_A, adviser=['not', 'a', 'string'])
