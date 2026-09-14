"""Functional Suitability tests for token-aware semantic chunking."""

import pytest

from config import settings
from services.chunker import (
    CHUNKING_VERSION,
    _is_section_heading,
    TOKENIZER_ENCODING,
    build_chunk_metadata,
    count_tokens,
    record_overlap_tokens,
    split_document,
    split_text,
    splitter,
    validate_chunk_records,
)
from services.document_processor import ExtractedDocument, ExtractedPage


class TestChunkerConfiguration:
    def test_paper_mandated_chunk_size(self):
        assert settings.chunk_size_tokens == 800
        assert settings.chunk_overlap_tokens == 100
        assert splitter._chunk_size == 800
        assert splitter._chunk_overlap == 100
        assert TOKENIZER_ENCODING == 'cl100k_base'
        assert CHUNKING_VERSION == 'token-v1'

    def test_short_text_single_chunk(self):
        chunks = split_text('A short abstract.')
        assert chunks == ['A short abstract.']

    def test_long_text_respects_chunk_size(self):
        text = ('The proposed system utilizes retrieval augmented generation. ' * 200)
        chunks = split_text(text)
        assert len(chunks) > 1
        assert all(count_tokens(chunk) <= 800 for chunk in chunks)

    def test_overlap_preserves_context(self):
        text = ' '.join(f'academic-token-{i:05d}' for i in range(3000))
        chunks = split_document(ExtractedDocument([ExtractedPage(1, text)]))
        overlaps = [
            record_overlap_tokens(left, right)
            for left, right in zip(chunks, chunks[1:])
        ]
        assert overlaps
        assert all(80 <= overlap <= 100 for overlap in overlaps)

    def test_empty_and_whitespace_text_produce_no_chunks(self):
        assert split_text('') == []
        assert split_text('   \n\n  ') == []

    def test_unicode_tables_citations_and_special_like_text_are_safe(self):
        block = (
            'Filipino: Layunin ng pag-aaral ang ligtas na retrieval. '
            '中文研究。日本語の研究。 Emoji 📚✨ combining e\u0301.\n'
            '| Sukatan | Halaga |\n|---|---|\n| Accuracy | 95% |\n'
            'Prior findings [1], [2], and (Gallardo, 2026). <|endoftext|>\n'
        )
        chunks = split_text(block * 700)
        assert len(chunks) > 1
        assert all(count_tokens(chunk) <= 800 for chunk in chunks)
        assert all('\ufffd' not in chunk for chunk in chunks)
        assert any('中文研究' in chunk for chunk in chunks)
        assert any('<|endoftext|>' in chunk for chunk in chunks)

    def test_long_unbroken_word_still_obeys_hard_limit(self):
        chunks = split_text('x' * 50000)
        assert len(chunks) > 1
        assert all(count_tokens(chunk) <= 800 for chunk in chunks)

    def test_chunking_is_deterministic(self):
        text = ('Deterministic archived evidence with citation [7]. ' * 900)
        assert split_text(text) == split_text(text)

    def test_validation_rejects_oversized_and_invalid_page_records(self):
        with pytest.raises(ValueError, match='token limit'):
            validate_chunk_records([{
                'content': 'x' * 50000, 'page_start': 1, 'page_end': 1,
            }])
        with pytest.raises(ValueError, match='Incomplete page range'):
            validate_chunk_records([{
                'content': 'Evidence', 'page_start': 1, 'page_end': None,
            }])


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
            'token_count': None,
            'tokenizer': 'cl100k_base',
            'chunk_size_tokens': 800,
            'chunk_overlap_tokens': 100,
            'chunking_version': 'token-v1',
        }

    def test_missing_values_default_to_empty(self):
        meta = build_chunk_metadata(None, None, None, None)
        assert meta == {
            'title': '', 'author': '', 'track': '', 'year': '', 'department': '',
            'page_start': None, 'page_end': None, 'section': None, 'chunk_index': None,
            'token_count': None, 'tokenizer': 'cl100k_base',
            'chunk_size_tokens': 800, 'chunk_overlap_tokens': 100,
            'chunking_version': 'token-v1',
        }

    def test_metadata_does_not_consume_content_budget(self):
        content = 'Grounded thesis evidence. ' * 100
        before = count_tokens(content)
        metadata = build_chunk_metadata(
            'A very long metadata title ' * 100,
            'Author Name ' * 100,
            'Data Mining', 2026,
            token_count=before,
        )
        assert count_tokens(content) == before
        assert metadata['token_count'] == before


class TestLocationAwareChunking:
    def test_cross_page_overlap_and_section_mapping(self):
        page_one = 'CHAPTER 3\nMETHODOLOGY\n' + ('Method detail sentence. ' * 170)
        page_two = 'Continuation from the prior page.\n' + ('More method evidence. ' * 170)
        document = ExtractedDocument([
            ExtractedPage(34, page_one),
            ExtractedPage(35, page_two),
        ])
        chunks = split_document(document)
        assert any(chunk['page_start'] == 34 and chunk['page_end'] == 35 for chunk in chunks)
        assert any(chunk['section'] == 'METHODOLOGY' for chunk in chunks)
        assert [chunk['chunk_index'] for chunk in chunks] == list(range(len(chunks)))
        assert all(chunk['token_count'] <= 800 for chunk in chunks)
        assert all(chunk['start_index'] < chunk['end_index'] for chunk in chunks)
        assert chunks == split_document(document)

    def test_txt_chunks_have_null_pages(self):
        chunks = split_document(ExtractedDocument([
            ExtractedPage(None, 'INTRODUCTION\n' + ('Archived evidence. ' * 250)),
        ]))
        assert chunks
        assert all(chunk['page_start'] is None and chunk['page_end'] is None for chunk in chunks)
        assert chunks[0]['section'] == 'INTRODUCTION'


class TestSectionHeadingDetection:
    """Every string here was read off the live index on 2026-09-14.

    The detector used to accept any line opening with a decimal number and any
    two-word all-caps line, so Likert legends, statistics sentences wrapped mid
    -clause, chart labels and hardware specs were all stored as section titles.
    A section label is worth triple in the lexical rerank and is printed into
    the model's context as "Section: ...", so these were both mis-ranking their
    chunks and misreporting where the passage came from.
    """

    @pytest.mark.parametrize('line', [
        'METHODOLOGY',
        'INTRODUCTION',
        'CHAPTER 3',
        'Review of Related Literature',
        'RESULTS AND DISCUSSIONS',
        'TECHNICAL BACKGROUND',
        '4.3.1 Evaluation Metrics',
        '2.1.1 Retrieval-Augmented Generation (RAG) Architecture',
        '6.1 : Summary',
        '2.6. TECHNICAL BACKGROUND',
        '3.1:  KEY CONCEPTS AND TERMINOLOGY',
        '4.3.1 User Testing Phase:',
    ])
    def test_accepts_real_headings(self, line):
        assert _is_section_heading(line)

    @pytest.mark.parametrize('line', [
        # A statistics sentence that wrapped onto its own line.
        '0.95 indicate moderately consistent responses, although some respondents differed in their',
        "0.82 to 0.81, which very slightly reflects the model's performance in identifying positive",
        # Likert legends and scale rows.
        '1.00 - 1.80',
        '3.41 - 4.20',
        '4.4 - STRONGLY AGREE',
        '4.3 -STRONGLY AGREE',
        # Extracted table rows and arithmetic.
        '0.922       1.615       1.269',
        '3.4 3.4 3.4',
        '1.732 * 1.732 = 1',
        '0.90 + 0.96',
        # A hardware spec list and a table caption.
        'RAM: 8 GB DDR4 SDRAM',
        '(PREPROCESSED) DATA.',
        'SILHOUETTE SCORE, DAVIES BOULDIN INDEX, AND INERTIA.',
        # A contents line keeps its page number out in the margin.
        '4.1 Developed an Automated Alumni Tracer Platform Using Web Crawler       35',
        # Pre-existing guards that must survive.
        'FIGURE REDACTED FOR SEMANTIC INDEXING',
        '',
        'and then the sentence simply continues in ordinary lower case prose',
    ])
    def test_rejects_body_text(self, line):
        assert not _is_section_heading(line)

    def test_a_rejected_line_inherits_the_heading_above_it(self):
        """Dropping a false heading must hand the chunk the real one, not None."""
        document = ExtractedDocument([ExtractedPage(61, '\n'.join([
            'METHODOLOGY',
            'Opening prose for the chapter. ' * 40,
            '0.95 indicate moderately consistent responses, although some respondents differed in their',
            'Continuing prose after the wrapped sentence. ' * 40,
        ]))])
        chunks = split_document(document)
        assert chunks
        assert {chunk['section'] for chunk in chunks} == {'METHODOLOGY'}
