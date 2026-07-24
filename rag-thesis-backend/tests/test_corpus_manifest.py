"""PI-08 corpus locking and tamper-evidence tests."""

import copy
import json
import uuid
from pathlib import Path

import pytest

from scripts.corpus_manifest import (
    ManifestError,
    lock_manifest,
    manifest_sha256,
    validate_manifest,
    verify_lock,
)


def _approval(role: str, marker: int) -> dict:
    return {
        'document_id': f'ISU-APPROVAL-{marker}',
        'approver_name': f'Authorized Approver {marker}',
        'approver_role': role,
        'approved_at': '2026-08-01',
        'document_sha256': f'{marker:064x}',
    }


def _paper(number: int) -> dict:
    programs = (
        ('BSCS', 'Data Mining'),
        ('BSIT', 'WMAD'),
        ('BSIT', 'NETSEC'),
        ('BSDSA', None),
        ('BSIS', None),
        ('BLIS', None),
    )
    program, specialization = programs[(number - 1) % len(programs)]
    return {
        'record_id': f'CCSICT-{number:03d}',
        'paper_id': str(uuid.UUID(int=number)),
        'title': f'Approved Thesis {number}',
        'authors': [f'Author {number}'],
        'year': 2020 + (number % 7),
        'program': program,
        'specialization': specialization,
        'selection_basis': 'Meets the faculty-approved purposive sampling criteria.',
        'source_sha256': f'{number:064x}',
        'redacted_sha256': f'{number + 100:064x}',
        'index_fingerprint_sha256': 'f' * 64,
        'rights_approval_document_id': f'RIGHTS-{number:03d}',
        'privacy_review_document_id': f'PRIVACY-{number:03d}',
        'unpaid_gemini_eligible': True,
    }


def _approved_manifest() -> dict:
    return {
        'schema_version': 1,
        'corpus_id': 'ISU-ECHAGUE-CCSICT-DEFENSE-2026',
        'status': 'approved',
        'department': 'CCSICT',
        'expected_paper_count': 50,
        'purpose': 'Fixed corpus for the approved CCSICT defense evaluation.',
        'processing_profile': {
            'gemini_service_tier': 'unpaid',
            'allowed_content': 'redacted_non_personal_non_confidential_only',
        },
        'approvals': {
            'ccsict_department_chair': _approval('CCSICT Department Chair', 1),
            'university_librarian': _approval('University Librarian', 2),
            'privacy_officer': _approval('Authorized Privacy Officer', 3),
            'thesis_adviser': _approval('Thesis Adviser', 4),
        },
        'papers': [_paper(number) for number in range(1, 51)],
    }


def test_template_shape_is_valid_as_an_unlocked_draft():
    manifest_path = Path(__file__).parents[1] / 'evaluation' / 'corpus' / 'corpus_manifest.template.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert not validate_manifest(manifest)


def test_approved_fifty_paper_manifest_is_lock_ready():
    assert not validate_manifest(_approved_manifest(), lock_ready=True)


@pytest.mark.parametrize(
    ('mutate', 'message'),
    [
        (lambda data: data['papers'].pop(), 'exactly 50'),
        (lambda data: data['papers'][1].update(record_id='CCSICT-001'), 'duplicate record_id'),
        (lambda data: data['papers'][1].update(source_sha256='0' * 63 + '1'), 'duplicate source_sha256'),
        (lambda data: data['papers'][0].update(specialization='WMAD'), 'invalid for BSCS'),
        (lambda data: data['papers'][0].update(title='TBD'), 'without placeholders'),
        (lambda data: data['papers'][0].update(unpaid_gemini_eligible=False), 'must be true'),
        (lambda data: data['approvals'].update(privacy_officer=None), 'completed approval object'),
    ],
)
def test_lock_readiness_rejects_incomplete_or_inconsistent_records(mutate, message):
    manifest = _approved_manifest()
    mutate(manifest)
    assert message in '\n'.join(validate_manifest(manifest, lock_ready=True))


def test_lock_sorts_records_writes_receipt_and_verifies(tmp_path):
    source = _approved_manifest()
    source['papers'].reverse()
    manifest_path = tmp_path / 'corpus.locked.json'
    receipt_path = tmp_path / 'corpus.receipt.json'

    locked, receipt = lock_manifest(
        source,
        manifest_path,
        receipt_path,
        locked_at='2026-08-01T09:00:00+08:00',
    )

    assert locked['papers'][0]['record_id'] == 'CCSICT-001'
    assert receipt['paper_count'] == 50
    assert receipt['manifest_sha256'] == manifest_sha256(locked)
    verify_lock(
        json.loads(manifest_path.read_text(encoding='utf-8')),
        json.loads(receipt_path.read_text(encoding='utf-8')),
    )


def test_lock_refuses_to_overwrite_immutable_artifacts(tmp_path):
    manifest_path = tmp_path / 'corpus.locked.json'
    receipt_path = tmp_path / 'corpus.receipt.json'
    lock_manifest(_approved_manifest(), manifest_path, receipt_path)
    with pytest.raises(ManifestError, match='overwrite'):
        lock_manifest(_approved_manifest(), manifest_path, receipt_path)


def test_lock_requires_distinct_outputs_and_timezone_aware_timestamp(tmp_path):
    same_path = tmp_path / 'same.json'
    with pytest.raises(ManifestError, match='different files'):
        lock_manifest(_approved_manifest(), same_path, same_path)
    with pytest.raises(ManifestError, match='UTC offset'):
        lock_manifest(
            _approved_manifest(),
            tmp_path / 'corpus.locked.json',
            tmp_path / 'corpus.receipt.json',
            locked_at='2026-08-01T09:00:00',
        )


def test_lock_readiness_rejects_invalid_approval_date():
    manifest = _approved_manifest()
    manifest['approvals']['privacy_officer']['approved_at'] = '08/01/2026'
    errors = '\n'.join(validate_manifest(manifest, lock_ready=True))
    assert 'ISO date' in errors


def test_validation_reports_non_string_identity_without_crashing():
    manifest = _approved_manifest()
    manifest['papers'][0]['record_id'] = ['not', 'a', 'string']
    errors = '\n'.join(validate_manifest(manifest, lock_ready=True))
    assert 'CCSICT-NNN' in errors


def test_verify_detects_manifest_tampering(tmp_path):
    locked, receipt = lock_manifest(
        _approved_manifest(),
        tmp_path / 'corpus.locked.json',
        tmp_path / 'corpus.receipt.json',
    )
    tampered = copy.deepcopy(locked)
    tampered['papers'][0]['title'] = 'Altered after approval'
    with pytest.raises(ManifestError, match='SHA-256'):
        verify_lock(tampered, receipt)
