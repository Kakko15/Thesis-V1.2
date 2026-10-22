"""Uploaded capsule proposals: reading PDF, Word and text into the four sections."""

import io
import zipfile
from types import SimpleNamespace
from xml.sax.saxutils import escape

import fitz
import pytest
from fastapi.testclient import TestClient

from main import app
from routers import duplication
from services import capsule_extract
from services.capsule_extract import CapsuleFileError, docx_text, split_capsule

CAPSULE = """ISABELA STATE UNIVERSITY
College of Computing Studies, Information and Communication Technology
CAPSULE PROPOSAL

Title: SECURE: A Smart Intruder Detection System Using Computer Vision

I. Rationale and Significance
Property owners lack affordable monitoring.
It matters because break-ins rose in 2025.

II. Research Objectives
General Objective
To detect intruders from CCTV frames.
Specific Objectives
1. Train a detector.

III. Methodology
YOLO object detection trained on a local dataset.
Methods used to gather data were interviews.

IV. Timeline
Month 1 - 3: development
V. Budget
PHP 5,000
Proponents: A. B."""


def docx_bytes(paragraphs, *, doctype=False):
    body = ''.join(
        f'<w:p><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>' for text in paragraphs
    )
    xml = (
        ('<!DOCTYPE lol [<!ENTITY a "aaaa">]>' if doctype else '')
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{body}</w:body></w:document>'
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', xml)
    return buffer.getvalue()


class TestSplitCapsule:
    def test_headings_route_text_into_the_four_sections(self):
        result = split_capsule(CAPSULE)
        assert result['title'] == 'SECURE: A Smart Intruder Detection System Using Computer Vision'
        assert result['rationale'].startswith('Property owners lack affordable monitoring.')
        # General and specific objectives both belong to the objectives section.
        assert result['objectives'] == 'To detect intruders from CCTV frames.\n1. Train a detector.'
        # A sentence that opens with a heading word stays body text.
        assert 'Methods used to gather data were interviews.' in result['methodology']
        assert result['detected_sections'] == ['title', 'rationale', 'objectives', 'methodology']

    def test_timeline_budget_and_proponents_are_dropped(self):
        result = split_capsule(CAPSULE)
        joined = ' '.join(result[key] for key in ('title', 'rationale', 'objectives', 'methodology'))
        assert 'Month 1' not in joined and 'PHP 5,000' not in joined and 'A. B.' not in joined

    def test_the_title_falls_back_to_the_first_line_that_is_not_letterhead(self):
        text = 'ISABELA STATE UNIVERSITY\nCapsule Proposal\nA Hydroponic Nutrient Scheduler Using Fuzzy Logic\n' \
               'Background of the Study\nFarmers struggle to schedule nutrients.'
        result = split_capsule(text)
        assert result['title'] == 'A Hydroponic Nutrient Scheduler Using Fuzzy Logic'
        assert result['rationale'] == 'Farmers struggle to schedule nutrients.'
        assert 'title' not in result['detected_sections']

    def test_nothing_recognisable_leaves_the_sections_blank(self):
        result = split_capsule('Just a paragraph with no headings at all.')
        assert result['rationale'] == result['objectives'] == result['methodology'] == ''
        assert result['detected_sections'] == []

    def test_scope_and_limitations_do_not_run_into_the_objectives(self):
        # The shape of a real upload (2026-09-24): limitations listed after the
        # objectives, and a methodology heading with extra words.
        text = """Title: RAG-Based AI-Powered Quiz Generation System
Background of the Study
Instructors assemble quizzes from lecture notes by hand.
Objectives of the Study
To generate quizzes from course modules.
Scope and Limitations
Self-assessment and instructional support.
Limitations
Internet Dependency: Requires active internet access.
Proposed Methodology and Tools
Retrieval-augmented generation over indexed course modules.
Methods used to gather data were surveys."""
        result = split_capsule(text)
        assert result['objectives'] == 'To generate quizzes from course modules.'
        screened = ' '.join(result[key] for key in ('title', 'rationale', 'objectives', 'methodology'))
        assert 'Internet Dependency' not in screened and 'Self-assessment' not in screened
        assert result['methodology'].startswith('Retrieval-augmented generation')
        # A sentence that opens with a heading word stays body text.
        assert result['methodology'].endswith('Methods used to gather data were surveys.')
        assert result['detected_sections'] == ['title', 'rationale', 'objectives', 'methodology']

    def test_other_methodology_headings_are_recognised(self):
        for heading in ('System Architecture', 'Research Design', 'Conceptual Framework',
                        'Tools and Technologies', 'Proposed System', 'Methodology and Tools'):
            result = split_capsule(f'Title: A Study of Things\n{heading}\nThe body of the section.')
            assert result['methodology'] == 'The body of the section.', heading

    def test_fields_are_capped_to_what_screening_accepts(self):
        result = split_capsule('Methodology\n' + 'word ' * 3000)
        assert len(result['methodology']) <= capsule_extract.FIELD_LIMITS['methodology']


class TestDocx:
    def test_paragraphs_come_back_one_per_line(self):
        assert docx_text(docx_bytes(['Title: A Study', 'Methodology', 'We measure.'])) == \
            'Title: A Study\nMethodology\nWe measure.'

    def test_a_doctype_is_refused(self):
        with pytest.raises(CapsuleFileError):
            docx_text(docx_bytes(['x'], doctype=True))

    def test_a_zip_that_is_not_a_word_document_is_refused(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('hello.txt', 'hi')
        with pytest.raises(CapsuleFileError, match='not a Word document'):
            docx_text(buffer.getvalue())
        with pytest.raises(CapsuleFileError):
            docx_text(b'PK not really a zip')

    def test_an_oversized_document_part_is_refused_before_inflating(self, monkeypatch):
        monkeypatch.setattr(capsule_extract, 'MAX_DOCUMENT_XML_BYTES', 64)
        with pytest.raises(CapsuleFileError, match='too large'):
            docx_text(docx_bytes(['a long enough paragraph to pass sixty-four bytes of xml']))


@pytest.fixture
def client():
    app.dependency_overrides[duplication.require_novelty_access] = lambda: SimpleNamespace(id='u1')
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(duplication.require_novelty_access, None)


def post(client, name, content, mime='application/octet-stream'):
    return client.post('/duplication/capsule/extract', files={'file': (name, content, mime)})


class TestExtractEndpoint:
    def test_a_word_capsule_fills_the_sections(self, client):
        response = post(client, 'capsule.docx', docx_bytes(CAPSULE.splitlines()))
        assert response.status_code == 200
        body = response.json()
        assert body['title'].startswith('SECURE')
        assert body['detected_sections'] == ['title', 'rationale', 'objectives', 'methodology']

    def test_a_text_capsule_fills_the_sections(self, client):
        response = post(client, 'capsule.txt', CAPSULE.encode(), 'text/plain')
        assert response.status_code == 200
        assert 'YOLO' in response.json()['methodology']

    def test_a_pdf_capsule_fills_the_sections(self, client):
        document = fitz.open()
        page = document.new_page()
        for index, line in enumerate(['Title: A Study of Campus Parking', 'Methodology',
                                      'We count cars every hour for a month.']):
            page.insert_text((72, 72 + index * 18), line)
        pdf = document.tobytes()
        document.close()
        response = post(client, 'capsule.pdf', pdf, 'application/pdf')
        assert response.status_code == 200
        assert response.json()['title'] == 'A Study of Campus Parking'
        assert 'count cars' in response.json()['methodology']

    def test_unsupported_and_disguised_files_are_refused(self, client):
        assert post(client, 'capsule.doc', b'\xd0\xcf\x11\xe0legacy word').status_code == 415
        assert post(client, 'capsule.docx', b'not a zip at all').status_code == 422
        assert post(client, 'capsule.pdf', b'not a pdf').status_code == 422

    def test_a_file_with_no_text_is_a_clear_422(self, client):
        response = post(client, 'capsule.txt', b'   \n  ', 'text/plain')
        assert response.status_code == 422
        assert 'No text' in response.json()['detail']
