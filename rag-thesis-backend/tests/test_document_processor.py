"""Functional Suitability tests — data digitization and cleaning pipeline."""

import fitz

from services import document_processor
from services.document_processor import (
    FIGURE_PLACEHOLDER,
    extract_document,
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


def _scanned_pdf() -> bytes:
    """A PDF whose second page is an image carrying no extractable text."""
    pdf = fitz.open()
    first = pdf.new_page()
    first.insert_text(
        (72, 72),
        'CHAPTER 1. This page holds enough real academic prose to be extracted '
        'directly without ever reaching the OCR fallback.',
    )
    second = pdf.new_page()
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 24, 24))
    pixmap.clear_with(255)
    second.insert_image(fitz.Rect(72, 72, 200, 200), stream=pixmap.tobytes('png'))
    payload = pdf.tobytes()
    pdf.close()
    return payload


class TestScannedPageDiagnostics:
    """Silent OCR loss is the failure this reports.

    Measured 2026-09-07: the twelve-thesis corpus extracted on a host without
    the tesserocr wheel lost 94 of 835 pages while logging only warnings, so an
    incomplete corpus was indistinguishable from a clean one.
    """

    def test_page_ocr_cannot_read_is_reported_one_based(self, monkeypatch):
        monkeypatch.setattr(document_processor, 'OCR_AVAILABLE', False)
        document = extract_pdf_document(_scanned_pdf())
        assert document.unresolved_scanned_pages == (2,)

    def test_page_ocr_recovers_is_not_reported(self, monkeypatch):
        monkeypatch.setattr(
            document_processor, '_ocr_page',
            lambda _page: ('Recovered scanned methodology discussion text.', True),
        )
        document = extract_pdf_document(_scanned_pdf())
        assert document.unresolved_scanned_pages == ()
        assert 'Recovered scanned methodology' in document.text

    def test_blank_scan_read_successfully_is_not_a_fault(self, monkeypatch):
        """OCR ran and the page really was empty: that must not block a thesis."""
        monkeypatch.setattr(document_processor, '_ocr_page', lambda _page: ('', True))
        assert extract_pdf_document(_scanned_pdf()).unresolved_scanned_pages == ()

    def test_text_document_reports_no_scanned_pages(self):
        assert extract_document(b'Plain notes.', 'notes.txt').unresolved_scanned_pages == ()

