"""Functional Suitability tests — semantic chunking (800 tokens / 100 overlap)."""

from config import settings
from services.chunker import build_chunk_metadata, split_text, splitter


class TestChunkerConfiguration:
    def test_paper_mandated_chunk_size(self):
        assert settings.chunk_size_tokens == 800
        assert settings.chunk_overlap_tokens == 100
        # ~4 chars per token calibration
        assert splitter._chunk_size == 3200
        assert splitter._chunk_overlap == 400

    def test_short_text_single_chunk(self):
        chunks = split_text('A short abstract.')
        assert chunks == ['A short abstract.']

    def test_long_text_respects_chunk_size(self):
        text = ('The proposed system utilizes retrieval augmented generation. ' * 200)
        chunks = split_text(text)
        assert len(chunks) > 1
        assert all(len(c) <= 3200 for c in chunks)

    def test_overlap_preserves_context(self):
        text = ''.join(f'Sentence number {i}. ' for i in range(400))
        chunks = split_text(text)
        # Consecutive chunks share overlapping text
        assert any(chunks[i][-50:] in chunks[i + 1] or chunks[i + 1][:50] in chunks[i]
                   for i in range(len(chunks) - 1))


class TestMetadataTagging:
    def test_full_metadata_json(self):
        meta = build_chunk_metadata('AI Thesis', 'Barlis & Gallardo', 'Data Mining', 2026)
        assert meta == {
            'title': 'AI Thesis',
            'author': 'Barlis & Gallardo',
            'track': 'Data Mining',
            'year': 2026,
        }

    def test_missing_values_default_to_empty(self):
        meta = build_chunk_metadata(None, None, None, None)
        assert meta == {'title': '', 'author': '', 'track': '', 'year': ''}
