"""Admin paper ingestion (thesis paper, Section 3.3 — Document Processing System).

Pipeline stages: extract (PyMuPDF + OCR fallback) -> clean (regex GIGO
mitigation) -> chunk (800-token / 100-token overlap) -> embed (Gemini,
768d) -> screen (automatic 85% duplication check against the archive,
paper Section 3.2.3 Phase 3) -> index (Supabase pgvector + metadata
tagging).

The API validates and privately stages each PDF, then a separate leased worker
executes the durable job while the admin UI polls authoritative database state.
Original PDFs are never publicly reachable (indirect access model).
"""

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

import fitz
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from dependencies.auth import require_upload_access, resolve_effective_department, sb
from models import (
    CCSICT_TRACKS,
    UploadAccepted,
    UploadCancelRequest,
    UploadCancelResponse,
    UploadJobStatus,
)
from services.cleanup import record_storage_cleanup
from services.rate_limiting import limiter
from services.operations import record_security_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/upload', tags=['upload'])

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


def _reserved_job(data) -> dict:
    if isinstance(data, list):
        return data[0] if data else {}
    return data or {}


def _rpc_boolean(data) -> bool:
    if isinstance(data, list):
        return bool(data and data[0])
    return bool(data)


def _fail_staging_job(job_id: str, category: str, *, cleanup_pending: bool) -> None:
    sb.table('upload_jobs').update({
        'status': 'failed',
        'stage': 'error',
        'progress': 100,
        'message': 'Private source staging failed.',
        'error': 'The upload could not be queued safely. Please try again.',
        'failure_category': category,
        'cleanup_status': 'pending' if cleanup_pending else 'not_required',
        'source_stored': cleanup_pending,
        'completed_at': datetime.now(timezone.utc).isoformat(),
        'expires_at': (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    }).eq('id', job_id).eq('status', 'staging').execute()


def _remove_staged_source(source_path: str, job_id: str) -> bool:
    try:
        sb.storage.from_('pdfs').remove([source_path])
        return True
    except Exception as cleanup_error:
        logger.error('Staged upload cleanup failed for %s (%s)', job_id, type(cleanup_error).__name__)
        record_storage_cleanup(
            sb,
            operation='rollback_upload',
            resource_path=source_path,
            job_id=job_id,
            error=cleanup_error,
        )
        return False


def _durable_job_status(job_id: str, owner_id: str) -> str | None:
    """Read authoritative queue state after an ambiguous RPC response."""
    current = (
        sb.table('upload_jobs').select('status')
        .eq('id', job_id).eq('owner_id', owner_id).limit(1).execute().data
    )
    return str(current[0]['status']) if current else None


@router.post('/paper', response_model=UploadAccepted, status_code=202)
@limiter.limit(settings.rate_limit_upload)
async def upload_paper(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    authors: str = Form(''),
    year: str = Form(''),
    abstract: str = Form(''),
    track: str = Form(''),
    department: str | None = Form(None),
    idempotency_key: str | None = Header(None, alias='Idempotency-Key'),
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
    try:
        effective_key = str(uuid.UUID(idempotency_key)) if idempotency_key else str(uuid.uuid4())
    except (TypeError, ValueError) as error:
        raise HTTPException(400, 'Idempotency-Key must be a valid UUID') from error

    job_id = str(uuid.uuid4())
    source_path = f'uploads/{user.id}/{job_id}/{safe_filename}'
    content_sha256 = hashlib.sha256(file_bytes).hexdigest()
    request_payload = {
        'title': title.strip(),
        'authors': authors.strip(),
        'year': year,
        'abstract': abstract,
        'track': track,
        'department': department,
        'uploader_id': user.id,
    }
    try:
        reserved = _reserved_job(sb.rpc('reserve_upload_job', {
            'p_job_id': job_id,
            'p_owner_id': user.id,
            'p_department': department,
            'p_idempotency_key': effective_key,
            'p_source_path': source_path,
            'p_original_filename': safe_filename,
            'p_content_sha256': content_sha256,
            'p_request_payload': request_payload,
            'p_max_attempts': settings.ingestion_max_attempts,
        }).execute().data)
    except Exception as error:
        if 'different content' in str(error).lower():
            raise HTTPException(409, 'Idempotency-Key was already used for another file') from error
        raise HTTPException(503, 'The durable upload queue is temporarily unavailable') from error
    if not reserved:
        raise HTTPException(503, 'The durable upload queue did not reserve the submission')

    job_id = str(reserved['job_id'])
    source_path = str(reserved['stored_source_path'])
    status = str(reserved['job_status'])
    if not reserved.get('created') and status != 'staging':
        return UploadAccepted(
            job_id=job_id,
            idempotency_key=effective_key,
            status=status,
            message='This submission is already tracked. Poll its existing job for progress.',
        )

    try:
        sb.storage.from_('pdfs').upload(
            source_path,
            file_bytes,
            file_options={'content-type': 'application/pdf', 'upsert': 'true'},
        )
    except Exception as error:
        removed = _remove_staged_source(source_path, job_id)
        try:
            _fail_staging_job(
                job_id,
                type(error).__name__,
                cleanup_pending=not removed,
            )
        except Exception as status_error:
            logger.error('Could not record staging failure for %s (%s)', job_id, type(status_error).__name__)
        raise HTTPException(503, 'The private manuscript could not be staged safely') from error

    try:
        queued = _rpc_boolean(sb.rpc('queue_upload_job', {
            'p_job_id': job_id,
            'p_owner_id': user.id,
        }).execute().data)
        if not queued and _durable_job_status(job_id, user.id) not in {
            'queued', 'processing', 'retry_wait', 'completed',
        }:
            raise RuntimeError('Durable queue transition was not confirmed')
    except Exception as error:
        # The response may be lost after PostgreSQL commits. Never compensate
        # an already-queued job by deleting the source underneath its worker.
        try:
            advanced = _durable_job_status(job_id, user.id) in {
                'queued', 'processing', 'retry_wait', 'completed',
            }
        except Exception:
            advanced = False
        if not advanced:
            removed = _remove_staged_source(source_path, job_id)
            try:
                _fail_staging_job(
                    job_id,
                    type(error).__name__,
                    cleanup_pending=not removed,
                )
            except Exception as status_error:
                logger.error(
                    'Could not record queue-transition failure for %s (%s)',
                    job_id, type(status_error).__name__,
                )
            raise HTTPException(503, 'The private manuscript could not be queued safely') from error

    return UploadAccepted(
        job_id=job_id,
        idempotency_key=effective_key,
        status='queued',
        message='Upload accepted by the durable worker queue.',
    )


@router.get('/status/{job_id}', response_model=UploadJobStatus)
def upload_status(job_id: str, user=Depends(require_upload_access)):
    extended_fields = (
        'id,owner_id,department,status,stage,progress,message,paper_id,'
        'chunks,duplication,error,attempt_count,max_attempts,next_retry_at,'
        'cancel_requested_at,cancelled_at,created_at,updated_at'
    )
    legacy_fields = (
        'id,owner_id,department,status,stage,progress,message,paper_id,'
        'chunks,duplication,error,attempt_count,max_attempts,next_retry_at,'
        'created_at,updated_at'
    )
    try:
        query = (
            sb.table('upload_jobs').select(extended_fields)
            .eq('id', job_id)
            .eq('owner_id', user.id)
            .limit(1)
        )
        try:
            result = query.execute()
        except Exception as schema_error:
            if 'cancel_requested_at' not in str(schema_error) and 'cancelled_at' not in str(schema_error):
                raise
            result = (
                sb.table('upload_jobs').select(legacy_fields)
                .eq('id', job_id).eq('owner_id', user.id).limit(1).execute()
            )
        job = result.data[0] if result.data else None
    except Exception as error:
        raise HTTPException(503, 'Upload status is temporarily unavailable') from error
    if not job:
        raise HTTPException(404, 'Upload job not found (it may have expired)')
    last_event_at = None
    try:
        event = (
            sb.table('upload_job_events').select('created_at')
            .eq('job_id', job_id).order('created_at', desc=True).limit(1).execute().data or []
        )
        last_event_at = event[0].get('created_at') if event else None
    except Exception:
        pass
    cancel_requested = bool(job.get('cancel_requested_at'))
    status = job.get('status', 'queued')
    return UploadJobStatus(
        job_id=job_id,
        status=status,
        stage=job.get('stage', ''),
        progress=job.get('progress', 0),
        message=job.get('message', ''),
        paper_id=job.get('paper_id'),
        chunks=job.get('chunks'),
        duplication=job.get('duplication'),
        error=job.get('error'),
        attempt_count=job.get('attempt_count', 0),
        max_attempts=job.get('max_attempts', settings.ingestion_max_attempts),
        next_retry_at=job.get('next_retry_at'),
        cancel_requested=cancel_requested,
        cancelled_at=job.get('cancelled_at'),
        can_cancel=status in {'staging', 'queued', 'retry_wait'} or (
            status == 'processing' and not cancel_requested
        ),
        last_event_at=last_event_at,
    )


@router.post('/jobs/{job_id}/cancel', response_model=UploadCancelResponse)
@limiter.limit(settings.rate_limit_upload)
def cancel_upload_job(
    request: Request,
    job_id: str,
    payload: UploadCancelRequest,
    user=Depends(require_upload_access),
):
    try:
        profile_rows = (
            sb.table('profiles').select('role,department')
            .eq('id', user.id).limit(1).execute().data or []
        )
        profile = profile_rows[0] if profile_rows else {}
        is_superadmin = profile.get('role') == 'superadmin'
        data = sb.rpc('request_upload_cancellation', {
            'p_job_id': job_id,
            'p_requester_id': user.id,
            'p_is_superadmin': is_superadmin,
            'p_reason': payload.reason,
        }).execute().data
        if isinstance(data, list):
            data = data[0] if data else {}
    except Exception as error:
        text = str(error).lower()
        if 'pgrst202' in text or 'could not find the function' in text:
            raise HTTPException(503, 'Upload cancellation requires the operations migration') from error
        raise HTTPException(503, 'Upload cancellation is temporarily unavailable') from error
    outcome = str((data or {}).get('outcome') or 'not_found')
    status = str((data or {}).get('status') or 'unknown')
    if outcome == 'not_found':
        raise HTTPException(404, 'Upload job not found')
    if outcome == 'forbidden':
        raise HTTPException(403, 'You cannot cancel this upload job')
    messages = {
        'cancelled': 'Upload cancelled and private-source cleanup queued.',
        'cancellation_requested': 'Cancellation requested. Processing will stop at the next safe checkpoint.',
        'already_terminal': f'Upload is already {status}.',
    }
    try:
        record_security_event(
            sb, 'upload_cancellation', actor_id=user.id,
            department=profile.get('department'),
            details={'job_id': job_id, 'outcome': outcome},
        )
    except Exception:
        logger.warning('Cancellation security event could not be recorded')
    return UploadCancelResponse(
        job_id=job_id,
        outcome=outcome,
        status=status,
        message=messages.get(outcome, 'Cancellation request completed.'),
        cancel_requested=outcome in {'cancelled', 'cancellation_requested'},
        cancelled_at=(data or {}).get('cancelled_at'),
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
