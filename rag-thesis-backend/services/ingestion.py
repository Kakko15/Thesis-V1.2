"""Pure durable thesis-ingestion pipeline used by the separate queue worker."""

import hashlib
import logging
import uuid
from collections.abc import Callable

import fitz

from config import settings
from services.activity import log_activity
from services.chunker import build_chunk_metadata, split_document, validate_chunk_records
from services.document_processor import extract_document, is_noise_chunk
from services.embedder import embed_texts
from services.index_provenance import current_index_fingerprint
from services.malware import MalwareDetected, scan_pdf
from services.novelty import screen_new_submission

logger = logging.getLogger(__name__)


class LeaseLostError(RuntimeError):
    """Raised when a worker may no longer mutate or finalize a claimed job."""


class PermanentIngestionError(RuntimeError):
    """Raised for deterministic manuscript failures that retries cannot repair."""


class MalwareDetectedIngestionError(PermanentIngestionError):
    """Raised when a private staged manuscript fails malware scanning."""


def _staged_pdf_bytes(client, source_path: str) -> bytes:
    content = client.storage.from_('pdfs').download(source_path)
    if isinstance(content, bytearray):
        return bytes(content)
    if not isinstance(content, bytes):
        raise RuntimeError('Private storage returned an invalid payload')
    return content


def _validate_staged_pdf(file_bytes: bytes, expected_sha256: str) -> None:
    if hashlib.sha256(file_bytes).hexdigest() != expected_sha256:
        raise PermanentIngestionError('The staged PDF hash did not match the reserved upload')
    if not file_bytes.startswith(b'%PDF-'):
        raise PermanentIngestionError('The staged source is not a PDF')
    try:
        document = fitz.open(stream=file_bytes, filetype='pdf')
        if document.needs_pass:
            document.close()
            raise PermanentIngestionError('Encrypted PDFs cannot be ingested')
        page_count = document.page_count
        document.close()
    except PermanentIngestionError:
        raise
    except Exception as exc:
        raise PermanentIngestionError('The staged PDF is unreadable') from exc
    if not 1 <= page_count <= settings.max_pdf_pages:
        raise PermanentIngestionError('The staged PDF page count is outside the safety limit')


def _require_lease(heartbeat: Callable[..., bool], **updates) -> None:
    if not heartbeat(**updates):
        raise LeaseLostError('The ingestion worker lease is no longer valid')


def process_ingestion_job(client, job: dict, worker_id: str,
                          heartbeat: Callable[..., bool]) -> str:
    """Process one claimed job and atomically finalize its paper and job rows."""
    job_id = str(job['id'])
    payload = job.get('request_payload') or {}
    source_path = str(job.get('source_path') or '')
    filename = str(job.get('original_filename') or 'thesis.pdf')
    expected_hash = str(job.get('content_sha256') or '')
    if not source_path or not expected_hash:
        raise PermanentIngestionError('The durable upload source is incomplete')

    _require_lease(
        heartbeat,
        stage='download', progress=12,
        message='Downloading the private staged manuscript...',
    )
    file_bytes = _staged_pdf_bytes(client, source_path)
    _validate_staged_pdf(file_bytes, expected_hash)

    _require_lease(
        heartbeat,
        stage='malware_scan', progress=16,
        message='Scanning the private manuscript for malware...',
    )
    try:
        scan_pdf(file_bytes)
    except MalwareDetected as error:
        raise MalwareDetectedIngestionError('The staged manuscript failed malware scanning') from error

    _require_lease(
        heartbeat,
        stage='extract', progress=20,
        message='Extracting and cleaning text (PyMuPDF + OCR fallback)...',
    )
    document = extract_document(file_bytes, filename)
    if not document.text.strip():
        raise PermanentIngestionError('The manuscript contained no extractable text')

    _require_lease(
        heartbeat,
        stage='chunk', progress=40,
        message='Chunking the manuscript with verified token limits...',
    )
    try:
        chunk_records = validate_chunk_records([
            record for record in split_document(document)
            if not is_noise_chunk(record['content'])
        ])
    except (TypeError, ValueError) as exc:
        raise PermanentIngestionError('The manuscript produced invalid chunk records') from exc
    if not chunk_records:
        raise PermanentIngestionError('The manuscript contained no clean indexable text')
    chunks = [record['content'] for record in chunk_records]

    _require_lease(
        heartbeat,
        stage='embed', progress=58,
        message=f'Generating {len(chunks)} verified vector embeddings...',
    )
    embeddings = embed_texts(chunks)
    if len(embeddings) != len(chunks):
        raise PermanentIngestionError('Embedding count did not match chunk count')
    if any(len(vector) != settings.embedding_dimensions for vector in embeddings):
        raise PermanentIngestionError('Embedding dimensions did not match server configuration')

    department = str(payload.get('department') or job.get('department') or '')
    _require_lease(
        heartbeat,
        stage='screen', progress=72,
        message='Screening the manuscript against the department archive...',
    )
    duplication_scan = screen_new_submission(embeddings, department)

    year_value = str(payload.get('year') or '')
    year_int = int(year_value) if year_value.isdigit() else None
    title = str(payload.get('title') or '')
    authors = str(payload.get('authors') or '')
    track = str(payload.get('track') or '')
    uploader_id = str(job.get('owner_id') or payload.get('uploader_id') or '')
    paper_data = {
        'id': str(uuid.UUID(job_id)),
        'title': title,
        'authors': authors,
        'year': year_int,
        'abstract': str(payload.get('abstract') or ''),
        'track': track,
        'filename': filename,
        'storage_path': source_path,
        'chunk_count': len(chunks),
        'uploaded_by': uploader_id,
        'department': department,
        'redaction_stats': document.redaction_stats,
        'duplication_scan': duplication_scan,
        'index_provenance': current_index_fingerprint(),
    }
    chunk_rows = [
        {
            'chunk_index': record['chunk_index'],
            'content': record['content'],
            'page_start': record['page_start'],
            'page_end': record['page_end'],
            'section': record['section'],
            'metadata': build_chunk_metadata(
                title, authors, track, year_int,
                department=department,
                page_start=record['page_start'],
                page_end=record['page_end'],
                section=record['section'],
                chunk_index=record['chunk_index'],
                token_count=record['token_count'],
            ),
            'embedding': embedding,
        }
        for record, embedding in zip(chunk_records, embeddings)
    ]

    _require_lease(
        heartbeat,
        stage='index', progress=88,
        message='Atomically committing metadata and verified vectors...',
    )
    try:
        result = client.rpc('commit_upload_ingestion', {
            'p_job_id': job_id,
            'p_worker_id': worker_id,
            'p_paper': paper_data,
            'p_chunks': chunk_rows,
        }).execute()
        paper_id = str(result.data or job_id)
    except Exception as commit_error:
        # The response can be lost after PostgreSQL commits. The deterministic
        # paper/job pair is authoritative and makes this check idempotent.
        try:
            current_job = (
                client.table('upload_jobs')
                .select('status,paper_id,chunks')
                .eq('id', job_id).single().execute().data
            )
            current_paper = (
                client.table('papers')
                .select('id,ingestion_status,chunk_count')
                .eq('id', job_id).single().execute().data
            )
        except Exception:
            current_job = current_paper = None
        committed = (
            current_job and current_paper
            and current_job.get('status') == 'completed'
            and current_paper.get('ingestion_status') == 'ready'
            and current_paper.get('chunk_count') == len(chunk_rows)
        )
        if not committed:
            raise commit_error
        paper_id = str(current_paper['id'])
        logger.warning('Recovered successful durable ingestion after an ambiguous RPC response')

    try:
        log_activity(uploader_id, 'paper_upload', {
            'paper_id': paper_id,
            'title': title,
            'track': track,
            'chunks': len(chunks),
            'duplication_flagged': bool(duplication_scan and duplication_scan.get('flagged')),
            'matched_chunk_percentage': (duplication_scan or {}).get('matched_chunk_percentage', 0.0),
            'highest_similarity': (duplication_scan or {}).get('highest_similarity', 0.0),
        })
    except Exception as activity_error:  # paper commit must not be undone by audit availability
        logger.error('Upload activity logging failed (%s)', type(activity_error).__name__)
    return paper_id
