"""Functional Suitability tests — semantic chunking (800 tokens / 100 overlap)."""

from config import settings
from services.chunker import build_chunk_metadata, split_document, split_text, splitter
from services.document_processor import ExtractedDocument, ExtractedPage


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
            'department': '',
            'page_start': None,
            'page_end': None,
            'section': None,
            'chunk_index': None,
        }

    def test_missing_values_default_to_empty(self):
        meta = build_chunk_metadata(None, None, None, None)
        assert meta == {
            'title': '', 'author': '', 'track': '', 'year': '', 'department': '',
            'page_start': None, 'page_end': None, 'section': None, 'chunk_index': None,
        }


class TestLocationAwareChunking:
    def test_cross_page_overlap_and_section_mapping(self):
        page_one = 'CHAPTER 3\nMETHODOLOGY\n' + ('Method detail sentence. ' * 170)
        page_two = 'Continuation from the prior page.\n' + ('More method evidence. ' * 170)
        chunks = split_document(ExtractedDocument([
            ExtractedPage(34, page_one),
            ExtractedPage(35, page_two),
        ]))
        assert any(chunk['page_start'] == 34 and chunk['page_end'] == 35 for chunk in chunks)
        assert any(chunk['section'] == 'METHODOLOGY' for chunk in chunks)
        assert [chunk['chunk_index'] for chunk in chunks] == list(range(len(chunks)))

    def test_txt_chunks_have_null_pages(self):
        chunks = split_document(ExtractedDocument([
            ExtractedPage(None, 'INTRODUCTION\n' + ('Archived evidence. ' * 250)),
        ]))
        assert chunks
        assert all(chunk['page_start'] is None and chunk['page_end'] is None for chunk in chunks)
        assert chunks[0]['section'] == 'INTRODUCTION'
