"""Functional Suitability tests — data digitization and cleaning pipeline."""

import fitz

from services.document_processor import (
    FIGURE_PLACEHOLDER,
    _clean_page,
    _detect_repeated_lines,
    _remove_excluded_sections,
    extract_pdf_document,
    extract_pdf_text,
    extract_text,
    filter_noise_chunks,
    is_noise_chunk,
)


class TestNoiseChunkRule:
    """The paper's 15% non-alphanumeric discard rule."""

    def test_clean_academic_prose_is_kept(self):
        text = ('This study utilizes embedding models to perform unstructured text mining '
                'by converting raw academic text into high dimensional vectors')
        assert not is_noise_chunk(text)

    def test_ocr_garbage_is_discarded(self):
        assert is_noise_chunk('%%%@@@###!!!***&&&^^^~~|||///\\\\???<<<>>>')

    def test_empty_text_is_discarded(self):
        assert is_noise_chunk('')
        assert is_noise_chunk('   \n\t  ')

    def test_whitespace_does_not_count_as_noise(self):
        assert not is_noise_chunk('word ' * 200)

    def test_filter_removes_only_noisy_chunks(self):
        clean = 'A perfectly normal methodology section describing the research design in detail'
        noisy = '~~~###%%%^^^&&&***((()))___+++===[[[]]]'
        assert filter_noise_chunks([clean, noisy]) == [clean]


class TestPageCleaning:
    def test_page_number_lines_removed(self):
        for line in ['12', 'Page 12', '- 12 -', '-- 12 of 52 --', '  7  ']:
            assert _clean_page(line, set()) == ''

    def test_repeated_headers_removed(self):
        page = 'Running Header Title\nActual thesis content stays here.'
        cleaned = _clean_page(page, {'running header title'})
        assert 'Running Header Title' not in cleaned
        assert 'Actual thesis content stays here.' in cleaned

    def test_toc_leader_lines_removed(self):
        page = '1.2 Objectives of the Study ................ 14\nRegular sentence.'
        cleaned = _clean_page(page, set())
        assert 'Objectives of the Study' not in cleaned
        assert 'Regular sentence.' in cleaned

    def test_detect_repeated_lines_across_pages(self):
        pages = ['CCSICT Thesis 2024\nBody one'] * 6
        repeated = _detect_repeated_lines(pages)
        assert 'ccsict thesis 2024' in repeated


class TestExcludedSections:
    def test_bibliography_removed_until_next_chapter(self):
        text = ('Chapter 1\nIntroduction body.\n'
                'References\nLewis, P. (2020). RAG paper.\n'
                'Chapter 2\nTheory body.')
        result = _remove_excluded_sections(text)
        assert 'Lewis, P.' not in result
        assert 'Introduction body.' in result
        assert 'Theory body.' in result

    def test_table_of_contents_removed(self):
        text = 'Table of Contents\n1.1 Background ... 2\nChapter 1\nReal content.'
        result = _remove_excluded_sections(text)
        assert '1.1 Background' not in result
        assert 'Real content.' in result


class TestExtractText:
    def test_plain_text_passthrough(self):
        raw = 'Line one.\n\n\n\n\nLine two.'.encode('utf-8')
        assert extract_text(raw, 'notes.txt') == 'Line one.\n\nLine two.'

    def test_figure_placeholder_constant_matches_paper(self):
        assert FIGURE_PLACEHOLDER == 'FIGURE REDACTED FOR SEMANTIC INDEXING'

    def test_pdf_extraction_retains_one_based_pages(self):
        pdf = fitz.open()
        for page_number in range(1, 3):
            page = pdf.new_page()
            page.insert_text(
                (72, 72),
                f'CHAPTER {page_number}\nThis page contains enough academic thesis content '
                'to exercise page-aware extraction and cleaning.',
            )
        payload = pdf.tobytes()
        pdf.close()

        document = extract_pdf_document(payload)
        assert [page.page_number for page in document.pages] == [1, 2]
        assert 'academic thesis content' in document.text
        assert extract_pdf_text(payload) == document.text
