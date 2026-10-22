"""scripts/backfill_paper_advisers.py: fill blanks only, and only with --apply."""

from types import SimpleNamespace

import pytest

from scripts import backfill_paper_advisers as backfill

PROSE = '\n'.join((
    'This study developed a web-based archive for undergraduate research that indexes',
    'manuscripts and supports retrieval of prior work by topic, author and year. It was',
    'evaluated with faculty and students across the five programs of the college, who',
    'found the retrieval accurate and the interface easy to use in daily research work.',
))
# Keyed by the bytes the fake bucket hands back, so the real extractor runs.
PDF_TEXT = {
    b'with-identity': ['TITLE PAGE', f'ABSTRACT\nAdviser: Dr. Ana D. Cruz\n\n{PROSE}'],
    b'without-adviser': ['TITLE PAGE', f'ABSTRACT\n\n{PROSE}'],
}


class _Query:
    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.filters = []
        self.payload = None

    def select(self, _fields):
        return self

    def eq(self, column, value):
        self.filters.append(('eq', column, value))
        return self

    def in_(self, column, values):
        self.filters.append(('in', column, tuple(values)))
        return self

    def is_(self, column, value):
        self.filters.append(('is', column, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args):
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            self.client.writes.append((self.payload, self.filters))
            return SimpleNamespace(data=[])
        if self.table == 'papers':
            self.client.paper_queries.append(self.filters)
            if self.client.papers_error:
                raise self.client.papers_error
            return SimpleNamespace(data=self.client.papers)
        paper_id = next(value for kind, column, value in self.filters if column == 'id')
        payload = self.client.payloads.get(paper_id)
        return SimpleNamespace(data=[{'request_payload': payload}] if payload is not None else [])


class _Bucket:
    def __init__(self, client):
        self.client = client

    def download(self, path):
        if path in self.client.broken_paths:
            raise RuntimeError('storage unavailable')
        return self.client.objects[path]


class _Client:
    def __init__(self, papers, *, payloads=None, objects=None, broken_paths=(), papers_error=None):
        self.papers = papers
        self.payloads = payloads or {}
        self.objects = objects or {}
        self.broken_paths = set(broken_paths)
        self.papers_error = papers_error
        self.writes = []
        self.paper_queries = []
        self.storage = SimpleNamespace(from_=lambda _bucket: _Bucket(self))

    def table(self, name):
        return _Query(self, name)


@pytest.fixture(autouse=True)
def fake_pdf_text(monkeypatch):
    monkeypatch.setattr(
        backfill, 'front_matter_texts', lambda data, _pages: PDF_TEXT[bytes(data)],
    )


def _paper(paper_id, **fields):
    return {'id': paper_id, 'title': f'Thesis {paper_id}', 'storage_path': f'{paper_id}.pdf', **fields}


def test_a_dry_run_reports_the_adviser_and_writes_nothing(capsys):
    client = _Client([_paper('p1')], objects={'p1.pdf': b'with-identity'})
    assert backfill.main([], client=client) == 0
    assert client.writes == []
    output = capsys.readouterr().out
    assert "[planned] Thesis p1: 'Dr. Ana D. Cruz' (abstract identity block)" in output
    assert 'Dry run.' in output


def test_apply_writes_only_the_adviser_and_only_where_it_is_still_null():
    client = _Client([_paper('p1')], objects={'p1.pdf': b'with-identity'})
    backfill.main(['--apply'], client=client)
    assert client.writes == [(
        {'adviser': 'Dr. Ana D. Cruz'},
        [('eq', 'id', 'p1'), ('is', 'adviser', 'null')],
    )]


def test_an_adviser_already_set_is_kept_and_never_written(capsys):
    client = _Client([_paper('p1', adviser='Prof. Set By Hand')], objects={'p1.pdf': b'with-identity'})
    backfill.main(['--apply'], client=client)
    assert client.writes == []
    assert "[kept] Thesis p1: 'Prof. Set By Hand'" in capsys.readouterr().out


def test_paper_ids_narrow_the_query_to_ready_papers():
    client = _Client([])
    backfill.main(['--paper-id', 'p1', '--paper-id', 'p2'], client=client)
    assert client.paper_queries == [[('eq', 'ingestion_status', 'ready'), ('in', 'id', ('p1', 'p2'))]]


def test_the_upload_payload_wins_over_the_pdf():
    client = _Client(
        [_paper('p1')],
        payloads={'p1': {'adviser': 'Engr. From Payload'}},
        objects={'p1.pdf': b'with-identity'},
    )
    report = backfill.find_adviser(client, client.papers[0])
    assert (report['adviser'], report['source']) == ('Engr. From Payload', 'upload payload')


def test_a_payload_value_that_is_not_a_name_falls_through_to_the_pdf():
    client = _Client(
        [_paper('p1')], payloads={'p1': {'adviser': ''}}, objects={'p1.pdf': b'with-identity'},
    )
    assert backfill.find_adviser(client, client.papers[0])['adviser'] == 'Dr. Ana D. Cruz'


def test_one_broken_paper_is_reported_and_the_run_continues(capsys):
    client = _Client(
        [_paper('p1'), _paper('p2'), _paper('p3', storage_path=None), _paper('p4')],
        objects={'p2.pdf': b'with-identity', 'p4.pdf': b'without-adviser'},
        broken_paths={'p1.pdf'},
    )
    assert backfill.main(['--apply'], client=client) == 0
    assert [payload for payload, _filters in client.writes] == [{'adviser': 'Dr. Ana D. Cruz'}]
    output = capsys.readouterr().out
    assert '[error] Thesis p1: RuntimeError: storage unavailable' in output
    assert '[skipped] Thesis p3: no storage_path' in output
    assert '[not-found] Thesis p4' in output
    assert 'wrote 1 adviser(s) across 4 paper(s)' in output


def test_a_project_without_the_column_is_told_which_migration_to_apply(capsys):
    client = _Client([], papers_error=RuntimeError('column papers.adviser does not exist'))
    assert backfill.main([], client=client) == 2
    assert '20260923_paper_adviser.sql' in capsys.readouterr().out


def test_any_other_read_failure_is_not_disguised_as_a_missing_migration():
    client = _Client([], papers_error=RuntimeError('connection reset'))
    with pytest.raises(RuntimeError, match='connection reset'):
        backfill.main([], client=client)
