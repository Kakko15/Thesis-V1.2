"""Automatic ingest-time duplication screening (thesis paper, Section 3.2.3 — Phase 3)."""

from services.novelty import aggregate_matches


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
