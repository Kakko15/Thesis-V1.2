"""Automatic ingest-time duplication screening (thesis paper, Section 3.2.3 — Phase 3)."""

from types import SimpleNamespace

from services import novelty
from services.novelty import (
    EXACT_DUPLICATE_SIMILARITY, aggregate_matches, is_exact_duplicate, meets_duplication_threshold, percent,
    verdict_for_coverage,
)


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
        assert verdict_for_coverage(100, exact_duplicate=True) == 'exact_duplicate'

    def test_most_similar_paper_is_the_top_ranked_match(self):
        matches = [
            {'paper_id': 'a', 'similarity': 0.86},
            {'paper_id': 'a', 'similarity': 0.91},
            {'paper_id': 'b', 'similarity': 0.99},
        ]
        scan = aggregate_matches(matches, total_chunks=3, threshold=0.85)
        assert scan['most_similar_paper'] == {'id': 'a', 'match_count': 2, 'similarity': 91.0}
        # Same object as the first ranked entry, so metadata enrichment reaches both.
        assert scan['most_similar_paper'] is scan['matched_papers'][0]

    def test_most_similar_paper_is_none_without_matches(self):
        assert aggregate_matches([], total_chunks=4, threshold=0.85)['most_similar_paper'] is None


class TestExactDuplicate:
    """A re-upload of an archived thesis is refused; two theses on one topic are not.

    The measured case (2026-09-08): a BLIS thesis whose 26 of 27 chunks matched
    another BLIS thesis at up to 0.9494 reached the archive flagged. That is
    high overlap, not a copy, and it must stay advisory.
    """

    def test_high_overlap_between_two_theses_stays_advisory(self):
        matches = [{'paper_id': 'other', 'similarity': 0.9494}] * 26
        scan = aggregate_matches(matches, total_chunks=27, threshold=0.85)
        assert scan['exact_duplicate'] is False
        assert scan['verdict_level'] == 'high_overlap'
        assert scan['flagged'] is True

    def test_every_chunk_verbatim_is_an_exact_duplicate(self):
        matches = [{'paper_id': 'same', 'similarity': 0.99999}] * 27
        scan = aggregate_matches(matches, total_chunks=27, threshold=0.85)
        assert scan['exact_duplicate'] is True
        assert scan['verdict_level'] == 'exact_duplicate'
        assert scan['most_similar_paper']['id'] == 'same'

    def test_one_unmatched_chunk_is_not_exact(self):
        matches = [{'paper_id': 'same', 'similarity': 1.0}] * 26
        assert is_exact_duplicate(matches, total_chunks=27) is False

    def test_one_paraphrased_chunk_is_not_exact(self):
        matches = [{'paper_id': 'same', 'similarity': 1.0}] * 26 + [{'paper_id': 'same', 'similarity': 0.97}]
        assert is_exact_duplicate(matches, total_chunks=27) is False

    def test_float_noise_below_one_still_counts(self):
        assert is_exact_duplicate([{'paper_id': 'p', 'similarity': EXACT_DUPLICATE_SIMILARITY}], 1) is True
        assert is_exact_duplicate([{'paper_id': 'p', 'similarity': 0.9989}], 1) is False

    def test_zero_chunks_is_never_exact(self):
        assert is_exact_duplicate([], total_chunks=0) is False

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
        # The uploader is told which archived thesis the manuscript resembles.
        assert scan['most_similar_paper']['title'] == 'Archived thesis'
        assert scan['most_similar_paper']['year'] == 2025
        assert scan['exact_duplicate'] is False


class TestRescanScoring:
    """The rescan scores candidate vectors directly instead of going through
    match_chunks, because an indexed paper crowds its own result set."""

    def test_reads_pgvector_json_strings_and_lists(self):
        assert novelty._as_vector('[1.0, 0.0]') == [1.0, 0.0]
        assert novelty._as_vector([1.0, 0.0]) == [1.0, 0.0]
        assert novelty._as_vector(None) == []

    def test_picks_the_closest_candidate(self):
        candidates = [
            ('far', [1.0, 1.0], 2 ** 0.5),
            ('near', [1.0, 0.0], 1.0),
        ]
        paper_id, similarity = novelty._best_archive_match([1.0, 0.0], candidates, 0.85)
        assert paper_id == 'near'
        assert similarity == 1.0

    def test_no_match_below_the_threshold(self):
        candidates = [('other', [0.0, 1.0], 1.0)]
        assert novelty._best_archive_match([1.0, 0.0], candidates, 0.85) == (None, 0.0)

    def test_threshold_boundary_is_inclusive(self):
        # A vector whose cosine against the query is exactly the threshold.
        candidates = [('other', [0.85, (1 - 0.85 ** 2) ** 0.5], 1.0)]
        paper_id, similarity = novelty._best_archive_match([1.0, 0.0], candidates, 0.85)
        assert paper_id == 'other'
        assert round(similarity, 10) == 0.85

    def test_zero_vector_never_matches(self):
        assert novelty._best_archive_match([0.0, 0.0], [('a', [1.0, 0.0], 1.0)], 0.85) == (None, 0.0)

    def test_empty_archive_is_not_a_match(self):
        assert novelty._best_archive_match([1.0, 0.0], [], 0.85) == (None, 0.0)


class TestScanProvenance:
    """A screening is a snapshot. Without these three fields nothing on the
    card says which archive it saw, so a stale verdict reads as a current one."""

    def test_stamp_records_when_and_against_how_much(self, monkeypatch):
        monkeypatch.setattr(novelty, '_archive_size', lambda *_args, **_kwargs: 12)
        scan = novelty._stamp_scan({'verdict_level': 'clear'}, 'CCSICT', novelty.SCOPE_AT_UPLOAD)
        assert scan['archive_size'] == 12
        assert scan['scan_scope'] == 'at_upload'
        assert scan['screened_at'].endswith('+00:00')

    def test_archive_size_never_breaks_a_screening(self, monkeypatch):
        def explode(*_args, **_kwargs):
            raise RuntimeError('PostgREST is down')

        monkeypatch.setattr(novelty, 'sb', SimpleNamespace(table=explode))
        assert novelty._archive_size('CCSICT') == 0
