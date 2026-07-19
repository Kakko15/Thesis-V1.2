"""Legacy chunk-to-page alignment tests."""

from services.document_processor import ExtractedDocument, ExtractedPage
from scripts.backfill_legacy_locations import align_chunks, validate_alignments


def test_aligns_legacy_boundaries_to_source_pages():
    document = ExtractedDocument([
        ExtractedPage(1, 'Chapter 1 Introduction\nBackground of the study uses semantic search.'),
        ExtractedPage(2, 'The proposed architecture uses retrieval augmented generation.'),
        ExtractedPage(3, 'The evaluation measures factual accuracy and reliability.'),
    ])
    chunks = [
        {
            'id': 10,
            'chunk_index': 0,
            'content': 'Background of the study uses semantic search. The proposed architecture '
                       'uses retrieval augmented generation.',
            'metadata': {},
        },
        {
            'id': 11,
            'chunk_index': 1,
            'content': 'The evaluation measures factual accuracy and reliability.',
            'metadata': {},
        },
    ]
    mappings = align_chunks(document, chunks, max_page_span=2)
    assert (mappings[0]['page_start'], mappings[0]['page_end']) == (1, 2)
    assert (mappings[1]['page_start'], mappings[1]['page_end']) == (3, 3)
    assert mappings[0]['section'] == 'Chapter 1 Introduction'
    assert mappings[0]['anchor_offset'] == 0
    validate_alignments(mappings, minimum_coverage=0.7)


def test_rejects_low_confidence_alignment():
    mappings = [{
        'chunk_index': 0, 'page_start': 1, 'page_end': 1,
        'coverage': 0.2, 'anchor_offset': 0,
    }]
    try:
        validate_alignments(mappings, minimum_coverage=0.7)
    except ValueError as error:
        assert 'Low-confidence' in str(error)
    else:
        raise AssertionError('Expected low-confidence mapping to be rejected')
