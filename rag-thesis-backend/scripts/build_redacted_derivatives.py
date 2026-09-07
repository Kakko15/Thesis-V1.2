"""Produce the PI-08 redacted derivatives a privacy reviewer reads and signs off.

Why this exists
---------------
The protocol requires, per manuscript, a redacted derivative that a human has
read end to end and a `redacted_sha256` recorded against it. The pipeline
already redacts -- `document_processor.redact_pii` plus the excluded-section
rules run inside `extract_document`, before chunking and embedding -- but it
does so in memory during ingestion. There was no artifact to review and nothing
to hash, so the protocol's redaction row could not be completed at all.

This script closes that gap by running the real `extract_document`, so what the
reviewer reads is what the embedder will actually send, not an approximation of
it. Two digests are recorded: `redacted_sha256` over the derivative text, and
`embedded_payload_sha256` over the concatenated chunk contents that survive
`split_document` and the noise filter -- the exact text that reaches the
provider.

OCR is fail-closed here for the same reason it is in ingestion. Measured
2026-09-07: extracting the twelve-thesis corpus on a host without the tesserocr
wheel dropped 94 of 835 pages and logged only warnings. A derivative built
without OCR would be hashed against content the container later indexes
differently, so the receipt would certify the wrong document.

Usage
-----
    python -m scripts.build_redacted_derivatives
    python -m scripts.build_redacted_derivatives --corpus-dir evaluation/corpus/private
    python -m scripts.build_redacted_derivatives --force        # overwrite derivatives

Run it in the same environment that will ingest -- the container, not a Windows
host -- or the digests describe a document the archive will never hold.
"""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from services.chunker import count_tokens, split_document
from services.document_processor import OCR_AVAILABLE, extract_document, is_noise_chunk

DEFAULT_CORPUS_DIR = Path('evaluation/corpus/private')
DERIVATIVE_SUFFIX = '.redacted.txt'
RECEIPT_NAME = 'redaction_receipts.json'

HUMAN_REVIEW_NOTE = (
    'Human review is mandatory before any of these reach a provider. The automated pass '
    'cannot certify narrative disclosures, faces or signatures in images, health or '
    'financial detail in prose, participant detail in tables, confidential partner data, '
    'or contextual re-identification.'
)


class DerivativeError(RuntimeError):
    """Raised when derivatives cannot be produced faithfully."""


def sha256_text(text: str) -> str:
    """Digest the UTF-8 form of a derivative, matching the manifest format."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def sha256_file(path: Path) -> str:
    """Digest a staged source PDF without loading it whole."""
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def build_derivative(pdf: Path) -> tuple[str, dict]:
    """Extract one manuscript and return its derivative text and receipt."""
    document = extract_document(pdf.read_bytes(), pdf.name)
    if document.unresolved_scanned_pages:
        pages = ', '.join(str(number) for number in document.unresolved_scanned_pages)
        raise DerivativeError(
            f'{pdf.name}: OCR could not read {len(document.unresolved_scanned_pages)} '
            f'scanned page(s) (pages {pages}). The derivative would be hashed against '
            'content the ingesting container reads differently. Install the tesserocr '
            'runtime and rerun.'
        )
    text = document.text
    if not text.strip():
        raise DerivativeError(f'{pdf.name}: extraction produced no text')

    chunks = [
        record['content'] for record in split_document(document)
        if not is_noise_chunk(record['content'])
    ]
    receipt = {
        'record_id': pdf.stem,
        'source_filename': pdf.name,
        'source_sha256': sha256_file(pdf),
        'redacted_sha256': sha256_text(text),
        'embedded_payload_sha256': sha256_text('\n'.join(chunks)),
        'pages_retained': len(document.pages),
        'derivative_characters': len(text),
        'embedded_chunks': len(chunks),
        'embedded_tokens': sum(count_tokens(chunk) for chunk in chunks),
        'redaction_stats': document.redaction_stats,
    }
    return text, receipt


def build_all(corpus_dir: Path, output_dir: Path, *, force: bool) -> dict:
    """Write every derivative and return the receipt sheet."""
    if not OCR_AVAILABLE:
        raise DerivativeError(
            'Tesseract OCR is not available in this environment. Derivatives built here '
            'would omit every scanned page and their digests would not match what the '
            'container indexes. Run this inside the application image.'
        )
    sources = sorted(corpus_dir.glob('CCSICT-*.pdf'))
    if not sources:
        raise DerivativeError(f'No CCSICT-*.pdf staged in {corpus_dir}')

    output_dir.mkdir(parents=True, exist_ok=True)
    receipts = []
    for pdf in sources:
        destination = output_dir / f'{pdf.stem}{DERIVATIVE_SUFFIX}'
        if destination.exists() and not force:
            raise DerivativeError(
                f'{destination} already exists. Re-run with --force only when you intend '
                'to discard a derivative a reviewer may already have read.'
            )
        text, receipt = build_derivative(pdf)
        destination.write_text(text, encoding='utf-8', newline='\n')
        receipt['derivative_file'] = destination.name
        receipts.append(receipt)
        print(
            f'{pdf.name}: {receipt["embedded_tokens"]:>7,} tokens  '
            f'{receipt["redacted_sha256"][:16]}...'
        )

    return {
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'ocr_available': OCR_AVAILABLE,
        'derivative_count': len(receipts),
        'total_embedded_tokens': sum(item['embedded_tokens'] for item in receipts),
        'note': HUMAN_REVIEW_NOTE,
        'derivatives': receipts,
    }


def main() -> int:
    """Build derivatives and write the receipt sheet beside them."""
    parser = argparse.ArgumentParser(description='Build PI-08 redacted derivatives.')
    parser.add_argument('--corpus-dir', type=Path, default=DEFAULT_CORPUS_DIR)
    parser.add_argument('--output-dir', type=Path, default=None,
                        help='defaults to <corpus-dir>/redacted')
    parser.add_argument('--force', action='store_true',
                        help='overwrite derivatives that already exist')
    arguments = parser.parse_args()

    output_dir = arguments.output_dir or (arguments.corpus_dir / 'redacted')
    try:
        sheet = build_all(arguments.corpus_dir, output_dir, force=arguments.force)
    except DerivativeError as error:
        print(f'error: {error}')
        return 1

    receipt_path = output_dir / RECEIPT_NAME
    receipt_path.write_text(
        json.dumps(sheet, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8', newline='\n',
    )
    print(
        f'\n{sheet["derivative_count"]} derivatives, '
        f'{sheet["total_embedded_tokens"]:,} embedded tokens'
    )
    print(f'receipts: {receipt_path}')
    print('Copy each redacted_sha256 into the working manifest only after a human has '
          'read that derivative.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
