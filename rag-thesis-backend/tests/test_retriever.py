"""Functional Suitability tests — retrieval ordering and indirect access model."""

from services.retriever import long_context_reorder, public_source


class TestLongContextReorder:
    """LongContextReorder must place the most relevant items at both ends."""

    def test_most_relevant_at_edges(self):
        items = [1, 2, 3, 4, 5]  # 1 = most relevant
        reordered = long_context_reorder(items)
        assert set(reordered) == set(items)
        # The two most relevant items must occupy the first and last slots
        assert {reordered[0], reordered[-1]} == {1, 2}
        # The least relevant item sinks to the middle
        assert reordered[len(reordered) // 2] == 5

    def test_empty_and_single(self):
        assert long_context_reorder([]) == []
        assert long_context_reorder([42]) == [42]

    def test_pairs(self):
        assert set(long_context_reorder(['a', 'b'])) == {'a', 'b'}


class TestIndirectAccessModel:
    """User-facing sources must NEVER leak file URLs, paths, or full text."""

    def test_public_source_strips_sensitive_fields(self):
        paper = {
            'id': 'abc', 'title': 'T', 'authors': 'A', 'year': 2024, 'track': 'Data Mining',
            'pdf_url': 'https://leak.example/full.pdf',
            'storage_path': 'secret/path.pdf',
            'content': 'FULL THESIS TEXT',
            'filename': 'original.pdf',
        }
        source = public_source(paper, 0.9123)
        assert set(source.keys()) == {'id', 'title', 'authors', 'year', 'track', 'similarity'}
        assert 'pdf_url' not in source
        assert 'storage_path' not in source
        assert 'content' not in source
        assert source['similarity'] == 91.23

    def test_public_source_without_similarity(self):
        source = public_source({'id': 'x', 'title': 'T'})
        assert 'similarity' not in source
