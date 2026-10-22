"""Capsule proposal screening: per-section scoring and the /duplication/capsule endpoint."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from pydantic import ValidationError

from routers import duplication
from services import capsule

THRESHOLD = 0.85

PAPERS = [
    {'id': 'p1', 'title': 'SECURE: A Smart Intruder Detection System Using Computer Vision',
     'authors': 'R. Gumpal', 'year': 2024, 'track': 'BSCS', 'department': 'CCSICT'},
    {'id': 'p2', 'title': 'Alumni Tracer Platform Using Web Crawler',
     'authors': 'F. Pagbilao', 'year': 2024, 'track': 'BSCS', 'department': 'CCSICT'},
]

BODY = {
    'title': 'A Smart Intruder Detection System Using Computer Vision',
    'rationale': 'Property owners lack affordable monitoring that recognises intruders in real time.',
    'objectives': 'To detect intruders from CCTV frames and alert the owner within seconds.',
    'methodology': 'YOLO object detection trained on a locally gathered dataset, evaluated with mAP.',
}


def chunk(paper_id, similarity):
    return {'paper_id': paper_id, 'similarity': similarity, 'content': 'archived passage text'}


def section(key, similarity=0.0, paper_id=None, basis='meaning'):
    return capsule.SectionResult(key=key, text=f'{key} text', similarity=similarity, paper_id=paper_id, basis=basis)


class TestCapsuleLogic:
    def test_title_wording_ignores_case_and_punctuation(self):
        assert capsule.title_wording_similarity('SECURE: A Smart System!', 'secure a smart system') == 1.0
        assert capsule.title_wording_similarity('Alumni tracer', 'Intruder detection') < 0.5
        assert capsule.title_wording_similarity('', 'anything') == 0.0

    def test_closest_title_picks_the_most_similarly_worded_paper(self):
        paper, score = capsule.closest_title(BODY['title'], PAPERS)
        assert paper['id'] == 'p1'
        assert score > 0.8

    def test_grade_uses_the_manuscript_bands_over_sections(self):
        # One of four sections flagged on one thesis is 25%: review suggested.
        one = capsule.grade([section('title', 0.9, 'p1'), section('rationale', 0.7, 'p1'),
                             section('objectives'), section('methodology')], THRESHOLD)
        assert one['total_chunks'] == 4 and one['matched_chunk_count'] == 1
        assert one['verdict_level'] == 'review_suggested'
        # Three of four on the same thesis is 75%: high overlap.
        three = capsule.grade([section('title', 0.9, 'p1'), section('rationale', 0.88, 'p1'),
                               section('objectives', 0.86, 'p1'), section('methodology', 0.5, 'p2')], THRESHOLD)
        assert three['verdict_level'] == 'high_overlap'
        assert three['ranked_papers'][0][0] == 'p1'
        assert three['ranked_papers'][0][1]['count'] == 3
        # Close but under the threshold everywhere: clear, nothing ranked.
        clear = capsule.grade([section('title', 0.8, 'p1'), section('rationale', 0.84, 'p2')], THRESHOLD)
        assert clear['verdict_level'] == 'clear'
        assert clear['matched_chunk_count'] == 0 and clear['ranked_papers'] == []
        assert clear['highest_similarity'] == 84.0

    def test_templated_title_wording_is_shown_but_not_flagged(self):
        # "... for ISU Cabagan" against "... for ISU Echague" shares a template,
        # not a study: a wording ratio of about 0.88 must not flag on its own,
        # and it is never reported as a passage similarity.
        ratio = capsule.title_wording_similarity(
            'Inventory Management System for ISU Cabagan', 'Inventory Management System for ISU Echague',
        )
        assert 0.85 <= ratio < capsule.TITLE_WORDING_FLAG
        graded = capsule.grade([section('title', ratio, 'p1', basis='wording'),
                                section('methodology', 0.7, 'p2')], THRESHOLD)
        assert graded['matched_chunk_count'] == 0
        assert graded['verdict_level'] == 'clear'
        assert graded['highest_similarity'] == 70.0
        # Near-identical wording still flags.
        assert section('title', 0.95, 'p1', basis='wording').flagged(THRESHOLD)

    def test_flags_split_across_theses_grade_on_the_largest_share(self):
        # Two flagged sections on two different theses is 25% each, not 50%.
        split = capsule.grade([section('title', 0.9, 'p1'), section('rationale', 0.9, 'p2'),
                               section('objectives'), section('methodology')], THRESHOLD)
        assert split['matched_chunk_count'] == 2
        assert split['verdict_level'] == 'review_suggested'

    def test_public_sections_hide_matches_under_the_display_floor(self):
        papers = {paper['id']: paper for paper in PAPERS}
        rows = capsule.public_sections([
            section('title', 0.92, 'p1', basis='wording'),
            section('rationale', 0.55, 'p2'),   # under the floor: not shown
            section('objectives'),
        ], papers, THRESHOLD)
        assert [row['key'] for row in rows] == ['title', 'rationale', 'objectives']
        assert rows[0]['flagged'] is True
        assert rows[0]['closest']['title'].startswith('SECURE')
        assert rows[0]['basis'] == 'wording'
        assert rows[1]['closest'] is None and rows[1]['similarity'] == 0.0
        assert rows[2]['closest'] is None
        # Metadata only: nothing from an archived chunk is in the public rows.
        assert all('archived_excerpt' not in row and 'text' not in row for row in rows)

    def test_summary_restates_each_section(self):
        papers = {paper['id']: paper for paper in PAPERS}
        rows = capsule.public_sections([section('title', 0.92, 'p1', basis='wording'), section('rationale')],
                                       papers, THRESHOLD)
        summary = capsule.summary_markdown(rows, 'review_suggested', THRESHOLD, 'CCSICT')
        assert 'Capsule screening: Review suggested' in summary
        assert '92.0% worded like' in summary and '**flagged**' in summary
        assert 'Rationale and significance:** no archived thesis is closely similar' in summary
        assert 'not a plagiarism verdict' in summary


class TestCapsuleRequest:
    def test_a_title_alone_is_refused(self):
        with pytest.raises(ValidationError, match='at least one of the rationale'):
            duplication.CapsuleScanReq(title='A Smart Intruder Detection System')

    def test_a_too_short_body_section_does_not_count(self):
        with pytest.raises(ValidationError):
            duplication.CapsuleScanReq(title='A Smart Intruder Detection System', rationale='Too short.')

    def test_one_substantial_section_is_enough(self):
        req = duplication.CapsuleScanReq(title='A Smart Intruder Detection System', methodology=BODY['methodology'])
        assert req.methodology == BODY['methodology']


class Query:
    def __init__(self, client, table):
        self.client, self.table, self.filters, self.payload = client, table, {}, None

    def select(self, *_args): return self
    def eq(self, field, value):
        self.filters[field] = value
        if self.table == 'papers':
            self.client.paper_filters.append((field, value))
        return self
    def in_(self, field, values): self.filters[field] = list(values); return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args): return self

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.table == 'scan_history':
            if self.client.missing_column:
                raise RuntimeError('column "capsule_sections" of relation "scan_history" does not exist (42703)')
            self.client.inserted = self.payload
            return SimpleNamespace(data=[{**self.payload, 'id': 'scan-1', 'created_at': '2026-09-23T00:00:00Z'}])
        if self.table == 'papers':
            ids = self.filters.get('id')
            rows = [p for p in PAPERS if ids is None or p['id'] in ids]
            return SimpleNamespace(data=rows)
        raise AssertionError(self.table)


class Client:
    def __init__(self, matches_by_piece, missing_column=False):
        self.matches_by_piece = list(matches_by_piece)
        self.rpc_calls = []
        self.paper_filters = []
        self.inserted = None
        self.missing_column = missing_column

    def rpc(self, name, args):
        self.rpc_calls.append((name, args))
        rows = self.matches_by_piece.pop(0) if self.matches_by_piece else []
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=rows))

    def table(self, name):
        return Query(self, name)


def run(body, client, monkeypatch, embed=None):
    monkeypatch.setattr(duplication, 'sb', client)
    monkeypatch.setattr(duplication, 'resolve_effective_department', lambda *_: 'CCSICT')
    monkeypatch.setattr(duplication, 'log_activity', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(duplication, 'embed_texts', embed or (lambda texts: [[0.1] * 768 for _ in texts]))
    request = Request({'type': 'http', 'method': 'POST', 'path': '/duplication/capsule', 'headers': [],
                       'query_string': b'', 'client': ('127.0.0.1', 1), 'server': ('t', 80), 'scheme': 'http'})
    endpoint = getattr(duplication.scan_capsule, '__wrapped__', duplication.scan_capsule)
    return asyncio.run(endpoint(request, duplication.CapsuleScanReq(**body), user=SimpleNamespace(id='u1')))


class TestCapsuleEndpoint:
    def test_each_section_is_screened_and_stored_as_a_scan(self, monkeypatch):
        client = Client([
            [chunk('p2', 0.62)],                    # title (meaning); wording beats it
            [chunk('p1', 0.91)],                    # rationale: flagged
            [chunk('p1', 0.88), chunk('p2', 0.7)],  # objectives: flagged
            [chunk('p2', 0.64)],                    # methodology: close, not flagged
        ])
        result = run(BODY, client, monkeypatch)

        # One embedding and one archive search per section piece, at the floor.
        assert [args['match_threshold'] for _name, args in client.rpc_calls] == [capsule.CLOSEST_FLOOR] * 4
        assert result['total_chunks'] == 4
        # Title wording (p1) plus rationale and objectives: three of four on p1.
        assert result['matched_chunk_count'] == 3
        assert result['verdict_level'] == 'high_overlap'
        assert result['top_matches'][0]['id'] == 'p1'
        assert result['top_matches'][0]['match_count'] == 3
        sections = {row['key']: row for row in result['capsule_sections']}
        assert sections['title']['basis'] == 'wording' and sections['title']['flagged']
        assert sections['methodology']['closest']['id'] == 'p2'
        assert sections['methodology']['flagged'] is False
        assert result['filename'] == BODY['title']
        # The archived excerpts ground the follow-up chat but are never returned,
        # and only flagged sections go in: the chat presents every pair as
        # duplicated text, so the close-but-clear methodology must stay out.
        assert 'matched_chunks' not in result
        assert all(pair['database_text'] for pair in client.inserted['matched_chunks'])
        assert {pair['section'] for pair in client.inserted['matched_chunks']} == {
            'Working title', 'Rationale and significance', 'Research questions / objectives',
        }
        # Only ready papers can be named.
        assert ('ingestion_status', 'ready') in client.paper_filters

    def test_a_capsule_resembling_nothing_is_clear(self, monkeypatch):
        client = Client([[], [], [], []])
        body = {**BODY, 'title': 'Hydroponic Nutrient Scheduling With Fuzzy Logic Controllers'}
        result = run(body, client, monkeypatch)
        assert result['verdict_level'] == 'clear'
        assert result['matched_chunk_count'] == 0
        assert result['top_matches'] == []
        assert all(row['closest'] is None or row['basis'] == 'wording' for row in result['capsule_sections'])

    def test_a_long_section_is_split_before_embedding(self, monkeypatch):
        embedded = []

        def embed(texts):
            embedded.extend(texts)
            return [[0.1] * 768 for _ in texts]

        long_methodology = ('The system gathers frames from each camera, filters motion, and classifies '
                            'every region with a trained detector. ') * 60
        client = Client([])
        run({**BODY, 'methodology': long_methodology[:6000]}, client, monkeypatch, embed=embed)
        assert len(embedded) > 4  # the methodology alone became several pieces
        assert len(client.rpc_calls) == len(embedded)

    def test_a_deterministic_archive_search_error_is_not_retried(self, monkeypatch):
        class Broken(Client):
            def rpc(self, name, args):
                raise KeyError('content')

        with pytest.raises(KeyError):
            run(BODY, Broken([]), monkeypatch)

    def test_embedding_capacity_is_a_retryable_503(self, monkeypatch):
        def exhausted(_texts):
            raise RuntimeError('429 RESOURCE_EXHAUSTED: quota exceeded')
        with pytest.raises(HTTPException) as caught:
            run(BODY, Client([]), monkeypatch, embed=exhausted)
        assert caught.value.status_code == 503
        assert 'Try this capsule again' in caught.value.detail

    def test_a_missing_migration_is_a_clear_503(self, monkeypatch):
        with pytest.raises(HTTPException) as caught:
            run(BODY, Client([], missing_column=True), monkeypatch)
        assert caught.value.status_code == 503
        assert 'migration' in caught.value.detail


def test_history_survives_a_project_without_the_capsule_column(monkeypatch):
    selects = []

    class HistoryQuery:
        def __init__(self): self.columns = ''
        def select(self, columns): self.columns = columns; selects.append(columns); return self
        def eq(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self

        def execute(self):
            if 'capsule_sections' in self.columns:
                raise RuntimeError('column scan_history.capsule_sections does not exist (42703)')
            return SimpleNamespace(data=[{'id': 's1'}])

    monkeypatch.setattr(duplication, 'sb', SimpleNamespace(table=lambda _name: HistoryQuery()))
    assert duplication.get_history(SimpleNamespace(id='u1')) == [{'id': 's1'}]
    assert 'capsule_sections' in selects[0] and 'capsule_sections' not in selects[1]


def test_history_does_not_swallow_other_database_errors(monkeypatch):
    class Broken:
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def order(self, *_args, **_kwargs): return self
        def limit(self, *_args): return self
        def execute(self): raise RuntimeError('connection refused')

    monkeypatch.setattr(duplication, 'sb', SimpleNamespace(table=lambda _name: Broken()))
    with pytest.raises(RuntimeError, match='connection refused'):
        duplication.get_history(SimpleNamespace(id='u1'))
