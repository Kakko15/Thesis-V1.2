"""Validate, lock, and verify the PI-08 defense corpus manifest.

The tool deliberately stores hashes and approval references instead of thesis
files or signature images. A corpus becomes immutable only after all fifty
records and every institutional/privacy gate are complete.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


EXPECTED_PAPER_COUNT = 50
APPROVAL_ROLES = (
    'ccsict_department_chair',
    'university_librarian',
    'privacy_officer',
    'thesis_adviser',
)
PROGRAM_SPECIALIZATIONS = {
    'BSCS': {'Data Mining'},
    'BSIT': {'WMAD', 'NETSEC'},
    'BSDSA': {None},
    'BSIS': {None},
    'BLIS': {None},
}
_SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
_RECORD_ID_RE = re.compile(r'^CCSICT-[0-9]{3}$')
_PLACEHOLDER_RE = re.compile(r'\b(?:replace|placeholder|tbd|todo)\b', re.IGNORECASE)


class ManifestError(ValueError):
    """Raised when a corpus manifest or lock receipt is invalid."""


def load_json(path: Path) -> dict[str, Any]:
    """Load a JSON object from disk with a stable validation error."""
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f'Unable to read valid JSON from {path}: {exc}') from exc
    if not isinstance(value, dict):
        raise ManifestError(f'{path} must contain a JSON object')
    return value


def canonical_bytes(value: dict[str, Any]) -> bytes:
    """Return the canonical UTF-8 representation used for corpus hashing."""
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(',', ':'),
        sort_keys=True,
    ).encode('utf-8')


def manifest_sha256(value: dict[str, Any]) -> str:
    """Calculate the canonical SHA-256 digest for a manifest."""
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _is_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not _PLACEHOLDER_RE.search(value)


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(_SHA256_RE.fullmatch(value))


def _is_iso_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _is_aware_iso_datetime(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def _validate_approval(name: str, value: Any, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append(f'approvals.{name} must be a completed approval object')
        return
    for field in ('document_id', 'approver_name', 'approver_role'):
        if not _is_text(value.get(field)):
            errors.append(f'approvals.{name}.{field} must be completed without placeholders')
    if not _is_iso_date(value.get('approved_at')):
        errors.append(f'approvals.{name}.approved_at must be an ISO date (YYYY-MM-DD)')
    if not _is_sha256(value.get('document_sha256')):
        errors.append(f'approvals.{name}.document_sha256 must be a lowercase SHA-256 digest')


def _validate_paper(index: int, paper: Any, errors: list[str]) -> None:
    prefix = f'papers[{index}]'
    if not isinstance(paper, dict):
        errors.append(f'{prefix} must be an object')
        return

    record_id = paper.get('record_id')
    if not isinstance(record_id, str) or not _RECORD_ID_RE.fullmatch(record_id):
        errors.append(f'{prefix}.record_id must use CCSICT-NNN format')
    try:
        uuid.UUID(str(paper.get('paper_id', '')))
    except ValueError:
        errors.append(f'{prefix}.paper_id must be a UUID')

    for field in (
        'title',
        'selection_basis',
        'rights_approval_document_id',
        'privacy_review_document_id',
    ):
        if not _is_text(paper.get(field)):
            errors.append(f'{prefix}.{field} must be completed without placeholders')

    authors = paper.get('authors')
    if not isinstance(authors, list) or not authors or not all(_is_text(item) for item in authors):
        errors.append(f'{prefix}.authors must contain at least one non-placeholder name')

    year = paper.get('year')
    if not isinstance(year, int) or isinstance(year, bool) or not 1900 <= year <= 2100:
        errors.append(f'{prefix}.year must be an integer from 1900 through 2100')

    program = paper.get('program')
    specialization = paper.get('specialization')
    allowed = PROGRAM_SPECIALIZATIONS.get(program)
    if allowed is None:
        errors.append(f'{prefix}.program must be a supported CCSICT program')
    elif specialization not in allowed:
        errors.append(f'{prefix}.specialization is invalid for {program}')

    for field in ('source_sha256', 'redacted_sha256', 'index_fingerprint_sha256'):
        if not _is_sha256(paper.get(field)):
            errors.append(f'{prefix}.{field} must be a lowercase SHA-256 digest')

    if paper.get('unpaid_gemini_eligible') is not True:
        errors.append(
            f'{prefix}.unpaid_gemini_eligible must be true after human privacy and confidentiality review'
        )


def validate_manifest(manifest: dict[str, Any], *, lock_ready: bool = False) -> list[str]:
    """Return all schema and lock-readiness errors without mutating input."""
    errors: list[str] = []
    if manifest.get('schema_version') != 1:
        errors.append('schema_version must be 1')
    if not _is_text(manifest.get('corpus_id')):
        errors.append('corpus_id must be completed without placeholders')
    if manifest.get('department') != 'CCSICT':
        errors.append('department must be CCSICT for the defense corpus')
    if manifest.get('expected_paper_count') != EXPECTED_PAPER_COUNT:
        errors.append(f'expected_paper_count must be {EXPECTED_PAPER_COUNT}')
    if not _is_text(manifest.get('purpose')):
        errors.append('purpose must be completed without placeholders')

    status = manifest.get('status')
    if status not in {'draft', 'approved', 'locked'}:
        errors.append('status must be draft, approved, or locked')
    if status == 'locked' and not _is_aware_iso_datetime(manifest.get('locked_at')):
        errors.append('locked_at must be an ISO-8601 timestamp with a UTC offset')

    processing = manifest.get('processing_profile')
    if not isinstance(processing, dict):
        errors.append('processing_profile must be an object')
    else:
        if processing.get('gemini_service_tier') != 'unpaid':
            errors.append('PI-08 defense processing_profile.gemini_service_tier must be unpaid')
        if processing.get('allowed_content') != 'redacted_non_personal_non_confidential_only':
            errors.append(
                'processing_profile.allowed_content must be redacted_non_personal_non_confidential_only'
            )

    papers = manifest.get('papers')
    if not isinstance(papers, list):
        errors.append('papers must be an array')
        papers = []
    for index, paper in enumerate(papers):
        _validate_paper(index, paper, errors)

    if lock_ready or status in {'approved', 'locked'}:
        if len(papers) != EXPECTED_PAPER_COUNT:
            errors.append(f'lock-ready corpus must contain exactly {EXPECTED_PAPER_COUNT} papers')
        approvals = manifest.get('approvals')
        if not isinstance(approvals, dict):
            errors.append('approvals must be an object')
        else:
            for role in APPROVAL_ROLES:
                _validate_approval(role, approvals.get(role), errors)

        record_ids = [paper.get('record_id') for paper in papers if isinstance(paper, dict)]
        paper_ids = [paper.get('paper_id') for paper in papers if isinstance(paper, dict)]
        source_hashes = [paper.get('source_sha256') for paper in papers if isinstance(paper, dict)]
        for label, values in (
            ('record_id', record_ids),
            ('paper_id', paper_ids),
            ('source_sha256', source_hashes),
        ):
            comparable = [value for value in values if isinstance(value, str)]
            if len(comparable) != len(set(comparable)):
                errors.append(f'papers contains duplicate {label} values')

    return errors


def _raise_errors(errors: list[str]) -> None:
    if errors:
        raise ManifestError('Manifest validation failed:\n- ' + '\n- '.join(errors))


def _write_json_exclusive(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('x', encoding='utf-8', newline='\n') as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write('\n')
    except FileExistsError as exc:
        raise ManifestError(f'Refusing to overwrite immutable artifact: {path}') from exc
    except OSError as exc:
        raise ManifestError(f'Unable to write immutable artifact {path}: {exc}') from exc


def lock_manifest(
    source: dict[str, Any],
    manifest_output: Path,
    receipt_output: Path,
    *,
    locked_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Create an immutable manifest and hash receipt without overwriting files."""
    if source.get('status') != 'approved':
        raise ManifestError('Only a manifest with status=approved can be locked')
    _raise_errors(validate_manifest(source, lock_ready=True))
    if manifest_output.resolve() == receipt_output.resolve():
        raise ManifestError('Manifest and receipt outputs must be different files')
    if manifest_output.exists() or receipt_output.exists():
        raise ManifestError('Refusing to overwrite an existing manifest or receipt')

    timestamp = locked_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if not _is_aware_iso_datetime(timestamp):
        raise ManifestError('locked_at must be an ISO-8601 timestamp with a UTC offset')
    locked = copy.deepcopy(source)
    locked['status'] = 'locked'
    locked['locked_at'] = timestamp
    locked['papers'] = sorted(locked['papers'], key=lambda item: item['record_id'])
    digest = manifest_sha256(locked)
    receipt = {
        'schema_version': 1,
        'corpus_id': locked['corpus_id'],
        'manifest_file': manifest_output.name,
        'manifest_sha256': digest,
        'paper_count': len(locked['papers']),
        'locked_at': timestamp,
    }
    _write_json_exclusive(manifest_output, locked)
    try:
        _write_json_exclusive(receipt_output, receipt)
    except (ManifestError, OSError):
        manifest_output.unlink(missing_ok=True)
        raise
    return locked, receipt


def verify_lock(manifest: dict[str, Any], receipt: dict[str, Any]) -> None:
    """Verify strict corpus validity and the canonical receipt digest."""
    if manifest.get('status') != 'locked':
        raise ManifestError('Manifest status must be locked')
    _raise_errors(validate_manifest(manifest, lock_ready=True))
    if receipt.get('schema_version') != 1:
        raise ManifestError('Receipt schema_version must be 1')
    if receipt.get('corpus_id') != manifest.get('corpus_id'):
        raise ManifestError('Receipt corpus_id does not match the manifest')
    if receipt.get('paper_count') != len(manifest['papers']):
        raise ManifestError('Receipt paper_count does not match the manifest')
    if receipt.get('locked_at') != manifest.get('locked_at'):
        raise ManifestError('Receipt locked_at does not match the manifest')
    if receipt.get('manifest_sha256') != manifest_sha256(manifest):
        raise ManifestError('Manifest SHA-256 does not match the lock receipt')


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)

    validate = commands.add_parser('validate', help='validate a draft or approved manifest')
    validate.add_argument('manifest', type=Path)
    validate.add_argument('--lock-ready', action='store_true')

    lock = commands.add_parser('lock', help='create immutable manifest and receipt files')
    lock.add_argument('manifest', type=Path)
    lock.add_argument('--manifest-output', type=Path, required=True)
    lock.add_argument('--receipt-output', type=Path, required=True)
    lock.add_argument('--locked-at', help='optional auditable ISO-8601 timestamp')

    verify = commands.add_parser('verify', help='verify a locked manifest against its receipt')
    verify.add_argument('manifest', type=Path)
    verify.add_argument('receipt', type=Path)
    return parser


def main() -> int:
    """Run the corpus-manifest command-line interface."""
    args = _parser().parse_args()
    try:
        manifest = load_json(args.manifest)
        if args.command == 'validate':
            _raise_errors(validate_manifest(manifest, lock_ready=args.lock_ready))
            result = {'valid': True, 'status': manifest.get('status')}
        elif args.command == 'lock':
            _locked, receipt = lock_manifest(
                manifest,
                args.manifest_output,
                args.receipt_output,
                locked_at=args.locked_at,
            )
            result = {'locked': True, **receipt}
        else:
            receipt = load_json(args.receipt)
            verify_lock(manifest, receipt)
            result = {'verified': True, 'manifest_sha256': manifest_sha256(manifest)}
    except ManifestError as exc:
        print(str(exc))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
