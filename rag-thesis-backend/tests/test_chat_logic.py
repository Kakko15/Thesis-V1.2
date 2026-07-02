"""Functional Suitability tests — citation post-processing and duplication math."""

from routers.chat import filter_cited_sources
from routers.duplication import compute_duplication_percentage


class TestCitationFiltering:
    SOURCES = [
        {'id': 'p1', 'title': 'First'},
        {'id': 'p2', 'title': 'Second'},
        {'id': 'p3', 'title': 'Third'},
    ]

    def test_only_cited_sources_returned(self):
        answer = 'The study [1] used CNNs while [3] used SVMs.'
        result = filter_cited_sources(answer, self.SOURCES)
        assert [s['id'] for s in result] == ['p1', 'p3']

    def test_no_citations_returns_empty(self):
        assert filter_cited_sources('General remark with no citations.', self.SOURCES) == []

    def test_out_of_range_citations_ignored(self):
        result = filter_cited_sources('See [1] and [9].', self.SOURCES)
        assert [s['id'] for s in result] == ['p1']

    def test_duplicate_citations_deduplicated(self):
        result = filter_cited_sources('First [1], again [1], and [2].', self.SOURCES)
        assert [s['id'] for s in result] == ['p1', 'p2']


class TestDuplicationPercentage:
    def test_paper_threshold_configuration(self):
        from config import settings
        assert settings.duplication_threshold == 0.85  # paper-mandated 85%

    def test_percentage_math(self):
        assert compute_duplication_percentage(0, 10) == 0
        assert compute_duplication_percentage(5, 10) == 50
        assert compute_duplication_percentage(10, 10) == 100

    def test_zero_total_chunks(self):
        assert compute_duplication_percentage(0, 0) == 0
