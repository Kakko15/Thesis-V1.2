"""Admin paper ingestion (thesis paper, Section 3.3 — Document Processing System).

Pipeline stages: extract (PyMuPDF + OCR fallback) -> clean (regex GIGO
mitigation) -> chunk (800-token / 100-token overlap) -> embed (Gemini,
768d) -> screen (automatic 85% duplication check against the archive,
paper Section 3.2.3 Phase 3) -> index (Supabase pgvector + metadata
tagging).

Runs as a background job with a polleable status endpoint so the admin UI
can display live pipeline progress. Original PDFs are stored in the
PRIVATE `pdfs` bucket — never publicly reachable (indirect access model).
"""

import logging
import mimetypes
import re
import threading
import time
import uuid
import json
from datetime import datetime, timezone

import fitz
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from dependencies.auth import require_upload_access, resolve_effective_department, sb
from models import CCSICT_TRACKS, UploadAccepted, UploadJobStatus
from services.activity import log_activity
from services.chunker import build_chunk_metadata, split_document
from services.cleanup import record_storage_cleanup
from services.document_processor import extract_document, is_noise_chunk
from services.embedder import embed_texts
from services.novelty import screen_new_submission
from services.rate_limiting import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/upload', tags=['upload'])

# Non-authoritative mirror used only for unit tests and local diagnostics.
# The durable source of truth is public.upload_jobs.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SECONDS = 3600


def _extract_title_page_metadata(text: str, departments: list[str]) -> dict[str, str]:
    """Extract conservative title-page fields without requiring an AI call."""
    lines = [line.strip() for line in (text or '').splitlines()]
    lines = [line for line in lines if line and not re.fullmatch(r'[_\W\d]+', line)]
    lowered = [line.casefold() for line in lines]

    title = ''
    boilerplate = (
        'a thesis', 'presented to', 'in partial fulfillment',
        'academic requirements', 'bachelor of', 'isabela state university',
    )
    for line in lines[:20]:
        folded = line.casefold()
        if 12 <= len(line) <= 240 and not any(term in folded for term in boilerplate):
            title = line
            break

    authors: list[str] = []
    by_index = next((i for i, value in enumerate(lowered) if value in {'by', 'by:'}), None)
    if by_index is not None:
        for line in lines[by_index + 1:by_index + 6]:
            if re.match(r'^(chapter|abstract|adviser|advisor)\b', line, re.IGNORECASE):
                break
            if re.fullmatch(r"[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,6}", line):
                authors.append(line)

    year_match = re.search(r'\b(?:19|20)\d{2}\b', '\n'.join(lines[:40]))
    department = ''
    full_text = (text or '').casefold()
    for candidate in departments:
        if candidate.casefold() in full_text:
            department = candidate
            break
    if not department and 'college of computing studies' in full_text:
        department = next((name for name in departments if name.casefold() == 'ccsict'), '')

    return {
        'title': title,
        'authors': ', '.join(authors),
        'year': year_match.group(0) if year_match else '',
        'department': department,
    }


def _sanitize_filename(filename: str | None) -> str:
    """Return a storage-safe PDF filename without client path components."""
    base = re.split(r'[\\/]+', filename or 'thesis.pdf')[-1]
    stem = re.sub(r'[^A-Za-z0-9._-]+', '_', base.rsplit('.', 1)[0]).strip('._')
    return f'{(stem or "thesis")[:100]}.pdf'


def _validate_pdf_upload(file_bytes: bytes, filename: str | None, content_type: str | None) -> str:
    """Validate the thesis PDF before extraction, storage, or Gemini use."""
    if not filename or not filename.lower().endswith('.pdf'):
        raise HTTPException(415, 'Only PDF thesis files are accepted')
    if content_type not in {'application/pdf', 'application/x-pdf'}:
        raise HTTPException(415, 'Upload MIME type must be application/pdf')
    if not file_bytes:
        raise HTTPException(400, 'Empty file')
    if len(file_bytes) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f'File exceeds the {settings.max_upload_mb} MB limit')
    if not file_bytes.startswith(b'%PDF-'):
        raise HTTPException(422, 'File content is not a valid PDF')
    try:
        document = fitz.open(stream=file_bytes, filetype='pdf')
        if document.needs_pass:
            document.close()
            raise HTTPException(422, 'Encrypted or password-protected PDFs are not accepted')
        page_count = document.page_count
        document.close()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, 'Malformed or unreadable PDF') from exc
    if page_count < 1:
        raise HTTPException(422, 'PDF must contain at least one page')
    if page_count > settings.max_pdf_pages:
        raise HTTPException(422, f'PDF exceeds the {settings.max_pdf_pages}-page safety limit')
    return _sanitize_filename(filename)


async def _read_limited_upload(file: UploadFile) -> bytes:
    """Read at most one byte beyond the configured limit to prevent memory abuse."""
    limit = settings.max_upload_mb * 1024 * 1024
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(413, f'File exceeds the {settings.max_upload_mb} MB limit')
    return content


def _validate_metadata(title: str, authors: str, year: str, abstract: str) -> None:
    if not 5 <= len(title.strip()) <= 300:
        raise HTTPException(422, 'Title must contain between 5 and 300 characters')
    if len(authors) > 500:
        raise HTTPException(422, 'Authors must not exceed 500 characters')
    if len(abstract) > 10000:
        raise HTTPException(422, 'Abstract must not exceed 10,000 characters')
    if year and (not year.isdigit() or len(year) != 4 or not 1978 <= int(year) <= datetime.now().year + 1):
        raise HTTPException(422, 'Year must be a valid four-digit completion year')


def _set_job(job_id: str, **updates):
    updates['updated_at'] = datetime.now(timezone.utc).isoformat()
    try:
        sb.table('upload_jobs').update(updates).eq('id', job_id).execute()
    except Exception:
        if settings.app_environment != 'test':
            raise
    with _JOBS_LOCK:
        job = _JOBS.setdefault(job_id, {'job_id': job_id, 'created_at': time.monotonic()})
        job.update(updates)


def _prune_jobs():
    now = time.monotonic()
    with _JOBS_LOCK:
        stale = [jid for jid, j in _JOBS.items() if now - j.get('created_at', now) > _JOB_TTL_SECONDS]
        for jid in stale:
            _JOBS.pop(jid, None)


def _ingest(job_id: str, file_bytes: bytes, filename: str,
            title: str, authors: str, year: str, abstract: str, track: str,
            department: str, uploader_id: str):
    """Full ingestion pipeline executed in the background."""
    paper_id = None
    storage_path = None
    try:
        # Stage 1: Data digitization (extract + clean)
        _set_job(job_id, status='processing', stage='extract', progress=10,
                 message='Extracting and cleaning text (PyMuPDF + OCR fallback)...')
        document = extract_document(file_bytes, filename)
        content = document.text
        if not content.strip():
            raise ValueError('Could not extract any text from the file')

        # Stage 2: Private storage of the original PDF
        _set_job(job_id, stage='store', progress=25, message='Archiving original file in private storage...')
        unique_filename = f'{uuid.uuid4()}_{filename}'
        content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        try:
            sb.storage.from_('pdfs').upload(unique_filename, file_bytes,
                                            file_options={'content-type': content_type})
            storage_path = unique_filename
        except Exception as e:
            raise RuntimeError('Required private storage upload failed') from e

        # Stage 3: Chunking (800-token / 100-token overlap) + noise filter
        _set_job(job_id, stage='chunk', progress=40,
                 message='Chunking manuscript (800-token windows, 100-token overlap)...')
        chunk_records = [
            record for record in split_document(document)
            if not is_noise_chunk(record['content'])
        ]
        chunks = [record['content'] for record in chunk_records]
        if not chunk_records:
            raise ValueError('The document contained no clean, indexable text after filtering')

        # Stage 4: Generate and verify every embedding before any searchable
        # paper row is created.
        _set_job(job_id, stage='embed', progress=60,
                 message=f'Generating {len(chunks)} vector embeddings (Gemini, 768d)...')
        embeddings = embed_texts(chunks)
        if len(embeddings) != len(chunks):
            raise ValueError('Embedding count did not match chunk count')
        if any(len(vector) != settings.embedding_dimensions for vector in embeddings):
            raise ValueError('Embedding dimensions did not match server configuration')

        # Stage 5: Automatic duplication screening (paper, Section 3.2.3
        # Phase 3) — the new submission is compared against the archive at
        # the 85% threshold BEFORE its own chunks are indexed, so the
        # manuscript never matches itself. Flags, never blocks.
        _set_job(job_id, stage='screen', progress=72,
                 message='Screening submission against the archive (85% duplication threshold)...')
        duplication_scan = screen_new_submission(embeddings, department)

        # Stage 6: Send one verified payload to a service-role-only PostgreSQL
        # RPC. Paper + chunks commit together, or PostgreSQL rolls back both.
        year_int = int(year) if str(year).isdigit() else None
        try:
            staged_paper_id = str(uuid.UUID(job_id))
        except ValueError:
            staged_paper_id = str(uuid.uuid4())
        paper_data = {
            'id': staged_paper_id,
            'title': title, 'authors': authors, 'year': year_int,
            'abstract': abstract, 'track': track,
            'filename': filename, 'storage_path': storage_path,
            'chunk_count': len(chunks), 'uploaded_by': uploader_id,
            'department': department,
            'redaction_stats': document.redaction_stats,
            'duplication_scan': duplication_scan,
        }
        _set_job(job_id, stage='index', progress=85,
                 message='Atomically committing metadata and verified vectors...')
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
                ),
                'embedding': emb,
            }
            for record, emb in zip(chunk_records, embeddings)
        ]
        try:
            sb.rpc('commit_paper_ingestion', {
                'p_paper': paper_data,
                'p_chunks': chunk_rows,
            }).execute()
        except Exception as commit_error:
            # A timeout may happen after PostgreSQL committed. Verify the
            # deterministic ID before compensating the separately stored PDF.
            try:
                committed = (
                    sb.table('papers').select('id,ingestion_status,chunk_count')
                    .eq('id', staged_paper_id).single().execute().data
                )
            except Exception:
                committed = None
            if not committed or committed.get('ingestion_status') != 'ready' \
                    or committed.get('chunk_count') != len(chunk_rows):
                raise commit_error
            logger.warning('Recovered a successful ingestion after an ambiguous RPC response')
        paper_id = staged_paper_id

        _set_job(job_id, status='completed', stage='done', progress=100,
                 message='Thesis indexed successfully.', paper_id=paper_id, chunks=len(chunks),
                 duplication=duplication_scan)
        log_activity(uploader_id, 'paper_upload', {
            'paper_id': paper_id, 'title': title, 'track': track, 'chunks': len(chunks),
            'duplication_flagged': bool(duplication_scan and duplication_scan.get('flagged')),
            'matched_chunk_percentage': (duplication_scan or {}).get('matched_chunk_percentage', 0.0),
            'highest_similarity': (duplication_scan or {}).get('highest_similarity', 0.0),
        })
    except Exception as e:
        logger.error('Ingestion job %s failed (%s)', job_id, type(e).__name__)
        # The database RPC is atomic, so only the separately stored original
        # may need compensating cleanup after a failed commit.
        if storage_path:
            try:
                sb.storage.from_('pdfs').remove([storage_path])
            except Exception as cleanup_error:
                logger.error(
                    'Failed to roll back stored file for job %s (%s)',
                    job_id,
                    type(cleanup_error).__name__,
                )
                record_storage_cleanup(
                    sb,
                    operation='rollback_upload',
                    resource_path=storage_path,
                    paper_id=paper_id,
                    job_id=job_id,
                    error=cleanup_error,
                )
        _set_job(job_id, status='failed', stage='error', progress=100,
                 message='Ingestion failed.', error='The thesis could not be safely indexed.')


@router.post('/paper', response_model=UploadAccepted, status_code=202)
@limiter.limit(settings.rate_limit_upload)
async def upload_paper(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    authors: str = Form(''),
    year: str = Form(''),
    abstract: str = Form(''),
    track: str = Form(''),
    department: str | None = Form(None),
    user=Depends(require_upload_access),
):
    department = resolve_effective_department(user, department)
    _validate_metadata(title, authors, year, abstract)
    if track:
        # Dynamically fetch valid tracks for the given department
        dept_res = sb.table('departments').select('tracks').eq('name', department).execute()
        valid_tracks = dept_res.data[0]['tracks'] if dept_res.data else CCSICT_TRACKS

        if track not in valid_tracks:
            valid_track_names = ', '.join(valid_tracks)
            raise HTTPException(
                422,
                f'Unknown track for department {department}. Valid tracks: {valid_track_names}',
            )

    file_bytes = await _read_limited_upload(file)
    safe_filename = _validate_pdf_upload(file_bytes, file.filename, file.content_type)

    _prune_jobs()
    job_id = str(uuid.uuid4())
    job_row = {
        'id': job_id,
        'owner_id': user.id,
        'department': department,
        'status': 'queued',
        'stage': 'extract',
        'progress': 0,
        'message': 'Queued for processing...',
    }
    sb.table('upload_jobs').insert(job_row).execute()
    with _JOBS_LOCK:
        _JOBS[job_id] = {'job_id': job_id, 'created_at': time.monotonic(), **job_row}
    background_tasks.add_task(_ingest, job_id, file_bytes, safe_filename,
                              title, authors, year, abstract, track, department, user.id)

    return UploadAccepted(job_id=job_id, status='queued',
                          message='Upload accepted. Poll /upload/status/{job_id} for progress.')


@router.get('/status/{job_id}', response_model=UploadJobStatus)
def upload_status(job_id: str, user=Depends(require_upload_access)):
    try:
        result = (
            sb.table('upload_jobs')
            .select(
                'id,owner_id,department,status,stage,progress,message,paper_id,'
                'chunks,duplication,error,created_at,updated_at'
            )
            .eq('id', job_id)
            .eq('owner_id', user.id)
            .limit(1)
            .execute()
        )
        job = result.data[0] if result.data else None
    except Exception as error:
        if settings.app_environment != 'test':
            raise HTTPException(
                503,
                'Upload status is temporarily unavailable',
            ) from error
        job = None
    if not job and settings.app_environment == 'test':
        with _JOBS_LOCK:
            candidate = _JOBS.get(job_id)
            job = candidate if candidate and candidate.get('owner_id') == user.id else None
    if not job:
        raise HTTPException(404, 'Upload job not found (it may have expired)')

    updated_at = job.get('updated_at')
    if job.get('status') in {'queued', 'processing'} and updated_at:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
            if age.total_seconds() > 20 * 60:
                _set_job(
                    job_id,
                    status='failed',
                    stage='error',
                    progress=100,
                    message='Ingestion stopped before completion.',
                    error='The worker stopped. Please submit the manuscript again.',
                )
                job.update({
                    'status': 'failed',
                    'stage': 'error',
                    'progress': 100,
                    'error': 'The worker stopped. Please submit the manuscript again.',
                })
        except (TypeError, ValueError):
            logger.warning('Upload job %s has an invalid updated_at value', job_id)
    return UploadJobStatus(
        job_id=job_id,
        status=job.get('status', 'queued'),
        stage=job.get('stage', ''),
        progress=job.get('progress', 0),
        message=job.get('message', ''),
        paper_id=job.get('paper_id'),
        chunks=job.get('chunks'),
        duplication=job.get('duplication'),
        error=job.get('error'),
    )


@router.get('/tracks')
def list_tracks():
    """CCSICT academic tracks for the upload form and archive filters."""
    return {'tracks': CCSICT_TRACKS}


@router.post('/extract-metadata')
@limiter.limit(settings.rate_limit_upload)
async def extract_metadata(
    request: Request,
    file: UploadFile = File(...),
    user=Depends(require_upload_access),
):
    """Extract thesis metadata locally, with Gemini filling missing fields."""
    local_data = {'title': '', 'authors': '', 'year': '', 'department': ''}
    try:
        file_bytes = await _read_limited_upload(file)
        _validate_pdf_upload(file_bytes, file.filename, file.content_type)
        doc = fitz.open(stream=file_bytes, filetype='pdf')

        # Use the title page as the authoritative source for bibliographic
        # fields. Later pages are context for Gemini, but their citation years
        # must never be mistaken for the thesis completion year.
        page_texts = [doc[i].get_text() for i in range(min(3, len(doc)))]
        title_page_text = page_texts[0] if page_texts else ''
        text = '\n'.join(page_texts)
        doc.close()

        if not text.strip():
            return {'title': '', 'authors': ''}

        # Fetch dynamic departments for prompt injection
        depts_res = sb.table('departments').select('name').execute()
        dept_names = [d['name'] for d in depts_res.data] if depts_res.data else ['CCSICT', 'CAS']
        dept_str = ", ".join(f'"{name}"' for name in dept_names)
        local_data = _extract_title_page_metadata(title_page_text, dept_names)

        if all(local_data.get(field) for field in ('title', 'authors', 'year', 'department')):
            return local_data

        llm = ChatGoogleGenerativeAI(
            model=settings.gemini_chat_model,
            google_api_key=settings.gemini_api_key,
            temperature=0.1,
        )

        prompt = f"""Extract the Title, Authors, Year completed, and Department of the thesis from the text below.
The Department should be exactly one of the following: {dept_str} or left blank if none of these are clearly found.
Return ONLY a valid JSON object with the keys "title", "authors", "year", and "department".
If you cannot find them, return an empty string for the values.
Do not wrap in markdown code blocks.

Text:
{text[:8000]}
"""
        result = llm.invoke(prompt)
        content = result.content if hasattr(result, 'content') else str(result)
        clean_json = content.strip().lstrip('`').lstrip('json').rstrip('`').strip()
        data = json.loads(clean_json)

        ai_year = str(data.get('year', '') or '').strip()
        if ai_year and not re.search(rf'\b{re.escape(ai_year)}\b', title_page_text):
            ai_year = ''
        return {
            'title': str(data.get('title', '') or local_data['title']),
            'authors': str(data.get('authors', '') or local_data['authors']),
            'year': local_data['year'] or ai_year,
            'department': str(data.get('department', '') or local_data['department']),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error('Metadata extraction failed (%s)', type(e).__name__)
        return local_data
