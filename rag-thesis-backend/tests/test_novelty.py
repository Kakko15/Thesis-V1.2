"""Automatic ingest-time duplication screening (thesis paper, Section 3.2.3 — Phase 3)."""

from types import SimpleNamespace

from services import novelty
from services.novelty import aggregate_matches, meets_duplication_threshold, percent, verdict_for_coverage


class TestAggregateMatches:
    def test_no_matches_is_not_flagged(self):
        scan = aggregate_matches([], total_chunks=40, threshold=0.85)
        assert scan['flagged'] is False
        assert scan['duplication_percentage'] == 0.0
        assert scan['matched_papers'] == []

    def test_threshold_reported_as_paper_percentage(self):
        scan = aggregate_matches([], total_chunks=10, threshold=0.85)
        assert scan['threshold'] == 85.0

    def test_zero_chunk_guard(self):
        scan = aggregate_matches([], total_chunks=0, threshold=0.85)
        assert scan['duplication_percentage'] == 0.0
        assert scan['flagged'] is False

    def test_percentage_is_share_of_matched_chunks(self):
        matches = [{'paper_id': 'a', 'similarity': 0.9}] * 5
        scan = aggregate_matches(matches, total_chunks=20, threshold=0.85)
        assert scan['flagged'] is True
        assert scan['duplication_percentage'] == 25.0
        assert scan['matched_chunk_percentage'] == 25.0
        assert scan['matched_chunk_count'] == 5
        assert scan['total_chunks'] == 20
        assert scan['highest_similarity'] == 90.0
        assert scan['verdict_level'] == 'review_suggested'

    def test_papers_ranked_by_match_count_then_similarity(self):
        matches = [
            {'paper_id': 'a', 'similarity': 0.86},
            {'paper_id': 'a', 'similarity': 0.91},
            {'paper_id': 'b', 'similarity': 0.99},
        ]
        scan = aggregate_matches(matches, total_chunks=3, threshold=0.85)
        assert [p['id'] for p in scan['matched_papers']] == ['a', 'b']
        assert scan['matched_papers'][0]['match_count'] == 2
        # Highest similarity per paper, expressed as a percentage
        assert scan['matched_papers'][0]['similarity'] == 91.0
        assert scan['matched_papers'][1]['similarity'] == 99.0

    def test_similarity_breaks_match_count_ties(self):
        matches = [
            {'paper_id': 'low', 'similarity': 0.86},
            {'paper_id': 'high', 'similarity': 0.97},
        ]
        scan = aggregate_matches(matches, total_chunks=2, threshold=0.85)
        assert [p['id'] for p in scan['matched_papers']] == ['high', 'low']

    def test_matched_papers_capped_at_top_three(self):
        matches = [{'paper_id': f'p{i}', 'similarity': 0.9} for i in range(5)]
        scan = aggregate_matches(matches, total_chunks=5, threshold=0.85)
        assert len(scan['matched_papers']) == 3

    def test_all_advisory_tiers(self):
        assert verdict_for_coverage(0) == 'clear'
        assert verdict_for_coverage(49.999) == 'review_suggested'
        assert verdict_for_coverage(50) == 'high_overlap'

    def test_legacy_and_public_percentage_normalization(self):
        assert percent(0.8499) == 84.99
        assert percent(0.85) == 85.0
        assert percent(0.8501) == 85.01
        assert percent(94.25) == 94.25

    def test_exact_inclusive_similarity_boundary(self):
        assert not meets_duplication_threshold(0.8499)
        assert meets_duplication_threshold(0.85)
        assert meets_duplication_threshold(0.8501)


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args):
        return self

    def in_(self, *_args):
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class _NoveltyClient:
    def __init__(self):
        self.calls = []

    def rpc(self, name, args):
        self.calls.append((name, args))
        rows = [{'paper_id': 'p1', 'similarity': 0.85}] if len(self.calls) == 1 else []
        return _Result(rows)

    def table(self, name):
        assert name == 'papers'
        return _Result([{
            'id': 'p1', 'title': 'Archived thesis', 'authors': 'Author', 'year': 2025,
            'track': 'Data Mining', 'department': 'CCSICT',
        }])


class TestSubmissionScreening:
    def test_department_threshold_and_metadata_propagate(self, monkeypatch):
        client = _NoveltyClient()
        monkeypatch.setattr(novelty, 'sb', client)
        scan = novelty.screen_new_submission([[0.1] * 768, [0.2] * 768], 'CCSICT')
        assert all(call[1]['p_department'] == 'CCSICT' for call in client.calls)
        assert all(call[1]['match_threshold'] == 0.85 for call in client.calls)
        assert scan['highest_similarity'] == 85.0
        assert scan['matched_chunk_count'] == 1
        assert scan['matched_papers'][0]['department'] == 'CCSICT'
