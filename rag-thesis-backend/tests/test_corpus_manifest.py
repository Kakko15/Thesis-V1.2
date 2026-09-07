"""PI-08 corpus locking and tamper-evidence tests."""

import copy
import json
import uuid
from pathlib import Path

import pytest

from scripts.corpus_manifest import (
    EXPECTED_PAPER_COUNT,
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
        'expected_paper_count': 12,
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
        'papers': [_paper(number) for number in range(1, 13)],
    }


def test_expected_paper_count_is_the_released_corpus_size():
    """CCSICT released twelve distinct manuscripts on 2026-09-07 and no more.

    Pinned as a literal because the number is also printed in the manuscript
    (sections 1.3, 3.1.3 and 3.2.1) and in the PI-08 protocol. If the department
    later releases another thesis, this test is the reminder that the paper and
    the protocol move with the constant.
    """
    assert EXPECTED_PAPER_COUNT == 12


def _composition() -> dict:
    """Matches the distribution `_paper` produces over twelve records."""
    return {
        'released_on': '2026-09-07',
        'note': 'Released set, recorded so the unrepresented categories are explicit.',
        'represented': [
            {'program': 'BSCS', 'specialization': 'Data Mining', 'count': 2},
            {'program': 'BSIT', 'specialization': 'WMAD', 'count': 2},
            {'program': 'BSIT', 'specialization': 'NETSEC', 'count': 2},
            {'program': 'BSDSA', 'specialization': None, 'count': 2},
            {'program': 'BSIS', 'specialization': None, 'count': 2},
            {'program': 'BLIS', 'specialization': None, 'count': 2},
        ],
        'unrepresented': [],
    }


def test_a_declared_composition_that_matches_the_records_is_lock_ready():
    manifest = _approved_manifest()
    manifest['released_composition'] = _composition()
    assert not validate_manifest(manifest, lock_ready=True)


@pytest.mark.parametrize(
    ('mutate', 'message'),
    [
        (lambda c: c['represented'][0].update(count=1), 'sum to 11'),
        (lambda c: c['represented'][0].update(specialization='WMAD'), 'invalid for BSCS'),
        (lambda c: c['represented'][0].update(program='BSNURSING'), 'supported CCSICT program'),
        (lambda c: c['represented'].append(
            {'program': 'BSCS', 'specialization': 'Data Mining', 'count': 3}),
         'duplicates an earlier represented category'),
        (lambda c: c['unrepresented'].append({'program': 'BSIS', 'specialization': None}),
         'also listed as represented'),
        (lambda c: c.update(released_on='soon'), 'must be an ISO date'),
        (lambda c: c['represented'][0].update(count=0), 'must be a positive integer'),
    ],
)
def test_released_composition_is_validated_not_decorative(mutate, message):
    """A lock must not certify a set whose mix contradicts the declared one.

    Without this the block is prose beside the records: the receipt would be
    valid and tamper-evident over a corpus whose category mix contradicts the
    composition section 4 of the PI-08 protocol fixes as non-substitutable.
    """
    manifest = _approved_manifest()
    manifest['released_composition'] = _composition()
    mutate(manifest['released_composition'])
    assert message in '\n'.join(validate_manifest(manifest, lock_ready=True))


def test_lock_readiness_rejects_records_that_contradict_the_composition():
    manifest = _approved_manifest()
    manifest['released_composition'] = _composition()
    manifest['papers'][0].update(program='BLIS', specialization=None)
    issues = '\n'.join(validate_manifest(manifest, lock_ready=True))
    assert 'papers do not match released_composition.represented' in issues


def test_composition_is_only_checked_against_records_once_lock_ready():
    """A draft may declare the target composition before the records exist."""
    manifest = _approved_manifest()
    manifest['status'] = 'draft'
    manifest['released_composition'] = _composition()
    manifest['papers'] = []
    assert not validate_manifest(manifest)


def test_template_shape_is_valid_as_an_unlocked_draft():
    manifest_path = Path(__file__).parents[1] / 'evaluation' / 'corpus' / 'corpus_manifest.template.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert not validate_manifest(manifest)


def test_approved_released_corpus_manifest_is_lock_ready():
    assert not validate_manifest(_approved_manifest(), lock_ready=True)


@pytest.mark.parametrize(
    ('mutate', 'message'),
    [
        (lambda data: data['papers'].pop(), 'exactly 12'),
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
    assert receipt['paper_count'] == 12
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
