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
# Like routers/chat.py: the single-file and batch endpoints deliberately share
# one module so the staging two-phase commit, the status mapping, and the
# metadata extraction each exist exactly once.
# pylint: disable=too-many-lines

import asyncio
import hashlib
import json
import logging
import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import fitz
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import TypeAdapter, ValidationError

from config import settings
from dependencies.auth import require_upload_access, resolve_effective_department, sb
from models import (
    CCSICT_TRACKS,
    BatchExtractResponse,
    BatchExtractedFile,
    BatchFileResult,
    BatchRow,
    BatchUploadAccepted,
    UploadAccepted,
    UploadCancelRequest,
    UploadCancelResponse,
    UploadJobList,
    UploadJobStatus,
)
from routers.catalog import active_track_names
from routers.openapi_responses import errors
from services.cleanup import record_storage_cleanup
from services.catalog import normalize_thesis_category, resolve_academic_selection
from services.db_errors import is_invalid_identifier
from services import prompts
from services.filenames import sanitize_filename
from services.llm_output import coerce_text, strip_code_fence
from services.rate_limiting import limiter
from services.operations import record_security_event
from services import gemini_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/upload', tags=['upload'])

# The Supabase SDK returns an opaque user record, so Any is the honest type.
UploadUser = Annotated[Any, Depends(require_upload_access)]

# A title page wraps its title across lines: ten of the twelve manuscripts
# CCSICT released on 2026-09-07 do. Reading only the first line autofilled
# 'DEVELOPMENT OF PERFORMANCE APPRAISAL SYSTEM FOR' and silently dropped
# 'ENHANCING MANPOWER AND PRODUCTIVITY' (CCSICT-007, measured 2026-09-07), and
# that truncated title would have carried into the citation, the archive row
# and the duplication screen. Continuation stops at the blank line or typed
# rule the template puts under the title, or at the document-type line that
# follows it. The boilerplate list cannot serve as that stop: two of the
# released titles name the university inside the title itself.
_TITLE_CONTINUATION_STOP = re.compile(
    r'^(?:an?\s+(?:thesis|capstone|research|dissertation|special|undergraduate|graduate)'
    r'|presented\s+to|in\s+partial\s+fulfillment|bachelor\s+of|master\s+of|by\s*:?$)',
    re.IGNORECASE,
)
_TITLE_MAX_LINES = 4
_TITLE_MAX_CHARS = 240


def _title_page_title(lines: list[str], gap_before: list[bool]) -> str:
    """Join the wrapped lines the title page sets as one thesis title."""
    boilerplate = (
        'a thesis', 'presented to', 'in partial fulfillment',
        'academic requirements', 'bachelor of', 'isabela state university',
    )
    start = next(
        (
            index for index, line in enumerate(lines[:20])
            if 12 <= len(line) <= _TITLE_MAX_CHARS
            and not any(term in line.casefold() for term in boilerplate)
        ),
        None,
    )
    if start is None:
        return ''

    parts = [lines[start]]
    length = len(parts[0])
    for index in range(start + 1, min(start + _TITLE_MAX_LINES, len(lines))):
        line = lines[index]
        if gap_before[index] or _TITLE_CONTINUATION_STOP.match(line):
            break
        if not 12 <= len(line) <= _TITLE_MAX_CHARS:
            break
        if length + 1 + len(line) > _TITLE_MAX_CHARS:
            break
        parts.append(line)
        length += 1 + len(line)
    return ' '.join(parts)


# A title page writes the same name three ways, and all three occur in the
# twelve manuscripts CCSICT released on 2026-09-07: 'Adrian T. Agustin',
# 'FERNANDO D. PAGBILAO JR.' and 'OLESCO, DANICA NICOLE F'. The comma form is
# the one that breaks the field, because authors are stored as a single
# comma-joined string: the two names on CCSICT-013 reached the review card as
# 'OLESCO, DANICA NICOLE F, RAMOS, DENISE RIKKI ISABEL H.', four comma-separated
# fragments with nothing to say which is a surname (observed 2026-09-07). The
# old pattern rejected any line holding a comma, so those manuscripts parsed to
# no authors at all and fell through to the model, which returned the page
# verbatim. Every name is normalised to the given-name-first, title-case form
# the controlled register uses, so a comma means a new author and nothing else.
_AUTHOR_DASH = re.compile(r'\s*[\u2010-\u2015\u2212-]\s*')
_AUTHOR_TOKEN = r"[A-Za-z][A-Za-z.'-]*"
_AUTHOR_NAME = re.compile(rf'{_AUTHOR_TOKEN}(?:\s+{_AUTHOR_TOKEN}){{1,6}}')
_NOT_A_NAME = (
    'track', 'university', 'college', 'thesis', 'project', 'department',
    'faculty', 'degree', 'bachelor', 'science', 'specialization',
)
_AUTHOR_SUFFIXES = {
    'jr': 'Jr.', 'jr.': 'Jr.', 'sr': 'Sr.', 'sr.': 'Sr.',
    'ii': 'II', 'iii': 'III', 'iv': 'IV',
}


def _author_token(token: str) -> str:
    """Recase one name token, leaving a token that is not shouted alone."""
    if token.casefold() in _AUTHOR_SUFFIXES:
        return _AUTHOR_SUFFIXES[token.casefold()]
    if len(token.strip('.')) == 1:
        # Every other name in the corpus writes its initials with the period,
        # so 'DANICA NICOLE F' and 'DANICA NICOLE F.' come out as one spelling.
        return f"{token.strip('.').upper()}."
    if not token.isupper():
        # 'Dela Cruz' and 'Jay-Ar' are already cased the way they are written,
        # and no recasing rule reproduces them from a lowercased form.
        return token
    return '-'.join(
        "'".join(piece.capitalize() for piece in part.split("'"))
        for part in token.split('-')
    )


def _normalize_author(raw: str) -> str:
    """Return one author as 'Given Names Surname', or '' if it is not a name."""
    name = _AUTHOR_DASH.sub('-', ' '.join((raw or '').split()))
    if any(word in name.casefold() for word in _NOT_A_NAME):
        # 'Data Mining Track' is shaped exactly like a three-part name, and it
        # sits within a few lines of 'By' on the manuscripts that carry one.
        return ''
    parts = [part.strip() for part in name.split(',')]
    if len(parts) == 2 and all(parts):
        name = f'{parts[1]} {parts[0]}'
    elif len(parts) != 1:
        return ''
    if not _AUTHOR_NAME.fullmatch(name):
        return ''
    return ' '.join(_author_token(token) for token in name.split())


_WHITESPACE = re.compile(r'\s+')


def _department_records(departments) -> list[dict[str, str]]:
    """Accept either the code list callers used to pass or full catalog rows."""
    records: list[dict[str, str]] = []
    for entry in departments or []:
        if isinstance(entry, str):
            records.append({'name': entry.strip(), 'title': ''})
        elif isinstance(entry, Mapping):
            records.append({
                'name': str(entry.get('name') or '').strip(),
                'title': str(entry.get('title') or '').strip(),
            })
    return [record for record in records if record['name']]


def _department_phrases(record: Mapping[str, str]) -> list[str]:
    """Spellings of one college that a title page actually prints.

    The code is almost never on the page; the prose title is. CCSICT is set as
    'College of Computing Studies, Information and Communication Technology',
    and a page naming only the college before the comma is naming the same
    department, so the leading segment counts too.
    """
    title = record['title']
    if not title:
        return []
    head = title.split(',', 1)[0].strip()
    return [title] if head == title else [title, head]


def _match_department(text: str, departments) -> str:
    """Resolve the title page's college to a department code.

    Scored by the longest spelling that matched rather than by the order the
    catalog happened to return, because a plain substring scan in row order
    sent every upload to the first short code the page could spell. 'CA'
    (College of Agriculture) sits inside both 'card' and 'communication', so on
    2026-09-08 a BLIS thesis whose page reads 'College of Computing Studies,
    Information and Communication Technology' autofilled as CA -- and a
    superadmin's form keeps the extracted value (pages/Upload.jsx), so it was
    submitted that way. Codes now match only as whole words, and the prose
    title, being longer and far more specific, outscores any code inside it.
    """
    haystack = _WHITESPACE.sub(' ', text or '').casefold()
    if not haystack:
        return ''
    best_name, best_score = '', 0
    for record in _department_records(departments):
        name = record['name']
        # A title page wraps the college name across lines, so both sides are
        # collapsed to single spaces before they are compared.
        scores = [
            len(needle) for needle in (
                _WHITESPACE.sub(' ', phrase).casefold()
                for phrase in _department_phrases(record)
            ) if needle in haystack
        ]
        if re.search(rf'\b{re.escape(name.casefold())}\b', haystack):
            scores.append(len(name))
        score = max(scores, default=0)
        if score > best_score:
            best_name, best_score = name, score
    return best_name


def _canonical_department(value: str, departments) -> str:
    """Map a model's department reply onto a real code, or drop it."""
    wanted = _WHITESPACE.sub(' ', value or '').strip().casefold()
    if not wanted:
        return ''
    for record in _department_records(departments):
        if wanted in {record['name'].casefold(), record['title'].casefold()}:
            return record['name']
    return ''


def _extract_title_page_metadata(
    text: str, departments: Sequence[str | Mapping[str, str]],
) -> dict[str, str]:
    """Extract conservative title-page fields without requiring an AI call."""
    lines: list[str] = []
    gap_before: list[bool] = []
    pending_gap = False
    for raw_line in (text or '').splitlines():
        line = raw_line.strip()
        if not line or re.fullmatch(r'[_\W\d]+', line):
            # A blank line and the typed rule under a title are the same signal:
            # the block ended. Both are dropped, and both are remembered.
            pending_gap = True
            continue
        lines.append(line)
        gap_before.append(pending_gap)
        pending_gap = False
    lowered = [line.casefold() for line in lines]

    title = _title_page_title(lines, gap_before)

    authors: list[str] = []
    by_index = next((i for i, value in enumerate(lowered) if value in {'by', 'by:'}), None)
    if by_index is not None:
        for index in range(by_index + 1, min(by_index + 6, len(lines))):
            line = lines[index]
            if re.match(r'^(chapter|abstract|adviser|advisor)\b', line, re.IGNORECASE):
                break
            if authors and gap_before[index]:
                # The names are set as one block. What follows the blank line
                # under them is the date or the adviser, never another author.
                break
            name = _normalize_author(line)
            if name:
                authors.append(name)

    year_match = re.search(r'\b(?:19|20)\d{2}\b', '\n'.join(lines[:40]))
    department = _match_department(text, departments)

    return {
        'title': title,
        'authors': ', '.join(authors),
        'year': year_match.group(0) if year_match else '',
        'department': department,
    }


def _as_text(value, fallback: str = '') -> str:
    """Flatten one extracted metadata field to the text the upload form expects.

    The prompt asks for JSON strings, but a reply is not bound by the ask, and
    the authors of a multi-author thesis come back as an array often enough to
    matter. `str()` on a list yields its Python repr -- brackets and quotes and
    all -- which was pre-filled into the form, submitted unchanged, stored, and
    rendered on the archive card as ['A. Author', 'B. Author']. Joining instead
    matches what `_extract_title_page_metadata` already produces for the local
    path, so both routes agree on the shape.

    Anything that is not text, a number, or a sequence of those has no sensible
    rendering here, so it yields the caller's fallback rather than a repr.
    """
    if isinstance(value, str):
        text = value.strip()
    elif isinstance(value, (list, tuple)):
        text = ', '.join(part for part in (_as_text(item) for item in value) if part)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        text = str(value)
    else:
        text = ''
    return text or fallback


def _normalize_author_field(value):
    """Normalise a model's author reply without re-splitting a plain string.

    A list is normalised item by item, because the model returns the title
    page's own order and a surname-first list would rejoin into exactly the
    comma soup the local path avoids. A bare string is left alone: its commas
    may already be separating whole authors, and reordering around one would
    turn 'Ana Cruz, Ben Diaz' into a single mangled name.
    """
    if isinstance(value, (list, tuple)):
        return [_normalize_author(_as_text(item)) or _as_text(item) for item in value]
    return value


def _sanitize_filename(filename: str | None) -> str:
    """Return a storage-safe PDF filename without client path components."""
    return sanitize_filename(filename, default_stem='thesis', force_suffix='pdf')


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
    # Timezone-aware on purpose: datetime.now() used the server's local zone
    # while every other timestamp in the codebase is UTC, so a New Year's Eve
    # upload could be accepted or rejected depending on the host's offset.
    current_year = datetime.now(timezone.utc).year
    if year and (not year.isdigit() or len(year) != 4 or not 1978 <= int(year) <= current_year + 1):
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
        logger.exception('Staged upload cleanup failed for %s (%s)', job_id, type(cleanup_error).__name__)
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


def _content_digest(file_bytes: bytes) -> str:
    """Hash the manuscript. Named so it can be offloaded off the event loop."""
    return hashlib.sha256(file_bytes).hexdigest()


def _reserve_durable_job(payload: dict) -> dict:
    return _reserved_job(sb.rpc('reserve_upload_job', payload).execute().data)


def _store_staged_source(source_path: str, file_bytes: bytes) -> None:
    sb.storage.from_('pdfs').upload(
        source_path,
        file_bytes,
        file_options={'content-type': 'application/pdf', 'upsert': 'true'},
    )


def _queue_durable_job(job_id: str, owner_id: str) -> bool:
    return _rpc_boolean(sb.rpc('queue_upload_job', {
        'p_job_id': job_id,
        'p_owner_id': owner_id,
    }).execute().data)


def _title_page_texts(file_bytes: bytes) -> list[str]:
    """Return the first three pages, which carry the bibliographic fields."""
    document = fitz.open(stream=file_bytes, filetype='pdf')
    try:
        return [document[index].get_text() for index in range(min(3, len(document)))]
    finally:
        document.close()


@dataclass(frozen=True)
class _StagingContext:
    """The batch-invariant half of a submission: who uploads, into which
    department, and how the manuscript is classified. Resolved once per request
    so a twenty-file batch performs the profile and catalog reads once, not
    twenty times."""
    user_id: str
    department: str
    category: str
    classification_payload: dict


def _parse_idempotency_key(value: str | None) -> str:
    try:
        return str(uuid.UUID(value)) if value else str(uuid.uuid4())
    except (TypeError, ValueError) as error:
        raise HTTPException(400, 'Idempotency-Key must be a valid UUID') from error


async def _resolve_staging_context(
    user, *, department: str | None, thesis_category: str,
    program_id: str | None, specialization_id: str | None, track: str,
) -> _StagingContext:
    department = await asyncio.to_thread(resolve_effective_department, user, department)
    category = normalize_thesis_category(thesis_category)
    # The program requirement follows the manuscript, not the uploader:
    # a student thesis always belongs to an academic program, while faculty
    # research may sit outside the undergraduate catalog entirely.
    classification = await asyncio.to_thread(
        resolve_academic_selection,
        sb,
        department_name=department,
        program_id=program_id,
        specialization_id=specialization_id,
        legacy_track=track,
        require_program=category == 'student',
    )
    return _StagingContext(
        user_id=user.id,
        department=department,
        category=category,
        classification_payload=classification.as_payload(),
    )


async def _stage_and_queue_one(
    ctx: _StagingContext, file: UploadFile, *, title: str, authors: str,
    year: str, abstract: str, idempotency_key: str | None,
) -> UploadAccepted:
    """Validate, privately stage, and durably queue one manuscript.

    Shared by the single-file and batch endpoints so both keep the same
    two-phase commit and compensation. Every blocking call is offloaded with
    asyncio.to_thread, matching routers/chat.py: FastAPI runs an `async def`
    handler on the event loop itself, so PDF parsing and the private storage
    upload of up to 25 MB previously stalled every other request, including
    /health and the readiness probe, for the whole submission.
    """
    file_bytes = await _read_limited_upload(file)
    safe_filename = await asyncio.to_thread(
        _validate_pdf_upload, file_bytes, file.filename, file.content_type,
    )
    effective_key = _parse_idempotency_key(idempotency_key)

    job_id = str(uuid.uuid4())
    source_path = f'uploads/{ctx.user_id}/{job_id}/{safe_filename}'
    content_sha256 = await asyncio.to_thread(_content_digest, file_bytes)
    request_payload = {
        'title': title.strip(),
        'authors': authors.strip(),
        'year': year,
        'abstract': abstract,
        **ctx.classification_payload,
        'thesis_category': ctx.category,
        'department': ctx.department,
        'uploader_id': ctx.user_id,
    }
    try:
        reserved = await asyncio.to_thread(_reserve_durable_job, {
            'p_job_id': job_id,
            'p_owner_id': ctx.user_id,
            'p_department': ctx.department,
            'p_idempotency_key': effective_key,
            'p_source_path': source_path,
            'p_original_filename': safe_filename,
            'p_content_sha256': content_sha256,
            'p_request_payload': request_payload,
            'p_max_attempts': settings.ingestion_max_attempts,
        })
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
        await asyncio.to_thread(_store_staged_source, source_path, file_bytes)
    except Exception as error:
        removed = await asyncio.to_thread(_remove_staged_source, source_path, job_id)
        try:
            await asyncio.to_thread(
                _fail_staging_job,
                job_id,
                type(error).__name__,
                cleanup_pending=not removed,
            )
        except Exception as status_error:
            logger.exception('Could not record staging failure for %s (%s)', job_id, type(status_error).__name__)
        raise HTTPException(503, 'The private manuscript could not be staged safely') from error

    try:
        queued = await asyncio.to_thread(_queue_durable_job, job_id, ctx.user_id)
        if not queued and await asyncio.to_thread(
            _durable_job_status, job_id, ctx.user_id,
        ) not in {'queued', 'processing', 'retry_wait', 'completed'}:
            raise RuntimeError('Durable queue transition was not confirmed')
    except Exception as error:
        # The response may be lost after PostgreSQL commits. Never compensate
        # an already-queued job by deleting the source underneath its worker.
        try:
            advanced = await asyncio.to_thread(
                _durable_job_status, job_id, ctx.user_id,
            ) in {'queued', 'processing', 'retry_wait', 'completed'}
        except Exception:
            advanced = False
        if not advanced:
            removed = await asyncio.to_thread(_remove_staged_source, source_path, job_id)
            try:
                await asyncio.to_thread(
                    _fail_staging_job,
                    job_id,
                    type(error).__name__,
                    cleanup_pending=not removed,
                )
            except Exception as status_error:
                logger.exception(
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


@router.post(
    '/paper', response_model=UploadAccepted, status_code=202,
    responses=errors(400, 409, 413, 415, 422, 503),
)
@limiter.limit(settings.rate_limit_upload)
async def upload_paper(
    request: Request,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()],
    user: UploadUser,
    authors: Annotated[str, Form()] = '',
    year: Annotated[str, Form()] = '',
    abstract: Annotated[str, Form()] = '',
    track: Annotated[str, Form()] = '',
    department: Annotated[str | None, Form()] = None,
    program_id: Annotated[str | None, Form()] = None,
    specialization_id: Annotated[str | None, Form()] = None,
    thesis_category: Annotated[str, Form()] = 'student',
    idempotency_key: Annotated[str | None, Header(alias='Idempotency-Key')] = None,
):
    # Department first, metadata second, catalog last: the order the clients
    # and their tests have always observed for a request that is wrong twice.
    department = await asyncio.to_thread(resolve_effective_department, user, department)
    _validate_metadata(title, authors, year, abstract)
    ctx = await _resolve_staging_context(
        user, department=department, thesis_category=thesis_category,
        program_id=program_id, specialization_id=specialization_id, track=track,
    )
    return await _stage_and_queue_one(
        ctx, file, title=title, authors=authors, year=year, abstract=abstract,
        idempotency_key=idempotency_key,
    )


# ---------------------------------------------------------------------------
# Batch submission
# ---------------------------------------------------------------------------
# The upload limit is 10 requests a minute per uploader, shared by staging,
# metadata extraction, and cancellation. Ingesting a shelf of theses through
# the single-file endpoint therefore spends the whole minute on ten manuscripts
# and 429s the eleventh, so a batch travels as one request per phase: one
# extraction call for all files, one staging call for all files.

_ROWS_ADAPTER = TypeAdapter(list[BatchRow])


def _check_batch_size(files: list[UploadFile]) -> None:
    if not files:
        raise HTTPException(422, 'A batch must contain at least one file')
    if len(files) > settings.max_batch_files:
        raise HTTPException(413, f'A batch may contain at most {settings.max_batch_files} files')


def _parse_batch_rows(raw: str, *, expected: int) -> list[BatchRow]:
    try:
        rows = _ROWS_ADAPTER.validate_json(raw)
    except ValidationError as error:
        raise HTTPException(
            422, 'rows must be a JSON list of {title, authors, year, idempotency_key} objects',
        ) from error
    if len(rows) != expected:
        raise HTTPException(422, f'rows lists {len(rows)} entries for {expected} files')
    seen: set[str] = set()
    for index, row in enumerate(rows):
        try:
            key = str(uuid.UUID(row.idempotency_key))
        except (TypeError, ValueError) as error:
            raise HTTPException(422, f'rows[{index}].idempotency_key must be a valid UUID') from error
        if key in seen:
            raise HTTPException(422, f'rows[{index}].idempotency_key repeats an earlier key')
        seen.add(key)
    return rows


def _batch_filename(file: UploadFile, index: int) -> str:
    return file.filename or f'file-{index}'


async def _stage_batch_file(
    ctx: _StagingContext, index: int, file: UploadFile, row: BatchRow,
) -> BatchFileResult:
    """Stage one file of a batch, folding its outcome into a per-file result.

    A batch never fails as a whole because one manuscript was encrypted or
    oversized: the client renders each rejection beside its row and resubmits
    only those files, under the same idempotency keys.
    """
    base = {'index': index, 'filename': _batch_filename(file, index), 'idempotency_key': row.idempotency_key}
    try:
        _validate_metadata(row.title, row.authors, row.year, '')
        accepted = await _stage_and_queue_one(
            ctx, file, title=row.title, authors=row.authors, year=row.year,
            abstract='', idempotency_key=row.idempotency_key,
        )
    except HTTPException as error:
        return BatchFileResult(**base, error=str(error.detail), status_code=error.status_code)
    except Exception as error:
        logger.exception('Batch file %d could not be staged (%s)', index, type(error).__name__)
        return BatchFileResult(
            **base, error='This file could not be staged. Please try it again.', status_code=500,
        )
    return BatchFileResult(
        **base, job_id=accepted.job_id, status=accepted.status, message=accepted.message,
    )


@router.post(
    '/batch', response_model=BatchUploadAccepted, status_code=202,
    responses=errors(400, 403, 413, 422, 503),
)
@limiter.limit(settings.rate_limit_upload)
async def upload_batch(
    request: Request,
    user: UploadUser,
    files: Annotated[list[UploadFile], File()],
    rows: Annotated[str, Form()],
    track: Annotated[str, Form()] = '',
    department: Annotated[str | None, Form()] = None,
    program_id: Annotated[str | None, Form()] = None,
    specialization_id: Annotated[str | None, Form()] = None,
    thesis_category: Annotated[str, Form()] = 'student',
):
    """Stage and queue several manuscripts that share one classification.

    `rows` is a JSON list aligned with `files`: per-file title, authors, year,
    and the client-minted idempotency key. Envelope problems (too many files,
    misaligned rows, a bad classification) are rejected before any file is
    read; per-file problems are reported in `results` and the request still
    returns 202 so the accepted files are not lost.
    """
    _check_batch_size(files)
    parsed = _parse_batch_rows(rows, expected=len(files))
    ctx = await _resolve_staging_context(
        user, department=department, thesis_category=thesis_category,
        program_id=program_id, specialization_id=specialization_id, track=track,
    )
    results: list[BatchFileResult] = []
    # Sequential on purpose: each file is read fully before validation, so
    # staging them concurrently would hold every manuscript of the batch in
    # memory at once, up to max_batch_files x max_upload_mb.
    for index, (file, row) in enumerate(zip(files, parsed)):
        results.append(await _stage_batch_file(ctx, index, file, row))
    accepted = sum(1 for result in results if result.job_id)
    return BatchUploadAccepted(accepted=accepted, rejected=len(results) - accepted, results=results)


# ---------------------------------------------------------------------------
# Job status
# ---------------------------------------------------------------------------

_MAX_JOB_IDS = 50
_JOB_FIELDS_EXTENDED = (
    'id,owner_id,department,status,stage,progress,message,paper_id,'
    'chunks,duplication,error,attempt_count,max_attempts,next_retry_at,'
    'cancel_requested_at,cancelled_at,created_at,updated_at'
)
_JOB_FIELDS_LEGACY = (
    'id,owner_id,department,status,stage,progress,message,paper_id,'
    'chunks,duplication,error,attempt_count,max_attempts,next_retry_at,'
    'created_at,updated_at'
)


def _select_upload_jobs(build) -> list[dict]:
    """Run `build(fields)` with the extended columns, then the legacy set.

    Pre-operations-migration schemas lack the cancellation columns; the read
    still succeeds there so the admin UI keeps polling.
    """
    try:
        return build(_JOB_FIELDS_EXTENDED).execute().data or []
    except Exception as schema_error:
        if 'cancel_requested_at' not in str(schema_error) and 'cancelled_at' not in str(schema_error):
            raise
        return build(_JOB_FIELDS_LEGACY).execute().data or []


def _last_event_at(job_id: str) -> str | None:
    try:
        event = (
            sb.table('upload_job_events').select('created_at')
            .eq('job_id', job_id).order('created_at', desc=True).limit(1).execute().data or []
        )
        return event[0].get('created_at') if event else None
    except Exception as error:
        # This field is presentational, so the request still succeeds without
        # it, but a bare `pass` hid genuine database problems with no log line
        # at all, which is exactly the case someone would need to diagnose.
        logger.warning(
            'Could not read the last upload event for %s (%s)',
            job_id, type(error).__name__,
        )
        return None


def _last_event_map(job_ids: list[str]) -> dict[str, str | None]:
    """Latest event timestamp per job in one read, for the batch poll."""
    try:
        rows = (
            sb.table('upload_job_events').select('job_id,created_at')
            .in_('job_id', job_ids).order('created_at', desc=True).execute().data or []
        )
    except Exception as error:
        logger.warning(
            'Could not read the last upload events for %d job(s) (%s)',
            len(job_ids), type(error).__name__,
        )
        return {}
    latest: dict[str, str | None] = {}
    for row in rows:
        latest.setdefault(str(row.get('job_id')), row.get('created_at'))
    return latest


def _job_status_model(job: dict, last_event_at: str | None) -> UploadJobStatus:
    cancel_requested = bool(job.get('cancel_requested_at'))
    status = job.get('status', 'queued')
    return UploadJobStatus(
        job_id=str(job.get('id')),
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


@router.get('/status/{job_id}', response_model=UploadJobStatus, responses=errors(404, 503))
def upload_status(job_id: str, user: UploadUser):
    try:
        jobs = _select_upload_jobs(
            lambda fields: sb.table('upload_jobs').select(fields)
            .eq('id', job_id).eq('owner_id', user.id).limit(1)
        )
    except Exception as error:
        # `upload_jobs.id` is a uuid column, so a mistyped job id is rejected by
        # Postgres rather than returning no rows. That is an absent job, not an
        # outage, and reporting 503 invited a client to keep retrying it.
        if is_invalid_identifier(error):
            raise HTTPException(404, 'Upload job not found (it may have expired)') from error
        raise HTTPException(503, 'Upload status is temporarily unavailable') from error
    if not jobs:
        raise HTTPException(404, 'Upload job not found (it may have expired)')
    job = dict(jobs[0])
    job.setdefault('id', job_id)
    return _job_status_model(job, _last_event_at(job_id))


def _parse_job_ids(raw: str) -> list[str]:
    """Comma-separated ids, deduplicated in request order, non-UUIDs dropped.

    A single malformed id inside an `in_()` filter makes Postgres reject the
    whole query, which would turn one stale entry in the client's list into an
    outage for every job beside it. Unknown ids simply produce no row.
    """
    ids: list[str] = []
    for candidate in raw.split(','):
        candidate = candidate.strip()
        if not candidate:
            continue
        try:
            normalized = str(uuid.UUID(candidate))
        except (TypeError, ValueError):
            continue
        if normalized not in ids:
            ids.append(normalized)
    if not ids:
        raise HTTPException(422, 'ids must list at least one upload job id')
    if len(ids) > _MAX_JOB_IDS:
        raise HTTPException(422, f'ids may list at most {_MAX_JOB_IDS} upload jobs')
    return ids


@router.get('/jobs', response_model=UploadJobList, responses=errors(422, 503))
def list_upload_jobs(ids: str, user: UploadUser):
    """Status of several of the caller's upload jobs in one read.

    The batch page polls every job of a submission together; per-job polling
    would cost two reads a job every tick and, for a twenty-file batch, exceed
    the global request limit on its own.
    """
    job_ids = _parse_job_ids(ids)
    try:
        rows = _select_upload_jobs(
            lambda fields: sb.table('upload_jobs').select(fields)
            .in_('id', job_ids).eq('owner_id', user.id)
        )
    except Exception as error:
        raise HTTPException(503, 'Upload status is temporarily unavailable') from error
    by_id = {str(row.get('id')): row for row in rows}
    events = _last_event_map(list(by_id)) if by_id else {}
    return UploadJobList(jobs=[
        _job_status_model(by_id[job_id], events.get(job_id))
        for job_id in job_ids if job_id in by_id
    ])


@router.post(
    '/jobs/{job_id}/cancel', response_model=UploadCancelResponse,
    responses=errors(403, 404, 503),
)
@limiter.limit(settings.rate_limit_upload)
def cancel_upload_job(
    request: Request,
    job_id: str,
    payload: UploadCancelRequest,
    user: UploadUser,
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
        if is_invalid_identifier(error):
            raise HTTPException(404, 'Upload job not found') from error
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
@limiter.limit(settings.rate_limit_public)
def list_tracks(request: Request):
    """Academic tracks for the archive filters and the public landing marquee.

    Derived from the live catalog rather than the frozen `CCSICT_TRACKS`
    constant. That constant is the pre-catalog vocabulary; the normalized
    catalog stamps `papers.track` with a specialization name or a program code,
    so four of its five values matched no paper. The stale list was rendered on
    the public landing page (`TracksMarquee`), in the superadmin archive filter,
    and in the admin upload-history filter.

    Unauthenticated, like the catalog reads it now depends on, so it carries the
    same explicit public limit — otherwise only the global default applied to an
    endpoint that performs three table reads.

    The constant survives as the fallback for a catalog outage, which keeps the
    landing page populated rather than blank.
    """
    try:
        # Scoped to the evaluation department. Unscoped, this unions every
        # ACTIVE department — and a live check found CAS active alongside
        # CCSICT, which put College of Arts and Sciences program codes on the
        # public landing marquee of a CCSICT thesis library.
        tracks = active_track_names(settings.thesis_evaluation_department)
    except Exception as error:
        logger.warning(
            'Live track vocabulary unavailable; serving the legacy constant (%s).',
            type(error).__name__,
        )
        return {'tracks': CCSICT_TRACKS}
    return {'tracks': tracks or CCSICT_TRACKS}


# ---------------------------------------------------------------------------
# Metadata extraction
# ---------------------------------------------------------------------------

_METADATA_FIELDS = ('title', 'authors', 'year', 'department')
# Gemini completions a batch extraction may run at once. Bounded because the
# pool's EXTRACT slot rotates keys reactively: a twenty-way fan-out would trip
# the capacity cooldown on every key before the first reply came back.
_EXTRACT_CONCURRENCY = 3


def _empty_metadata() -> dict[str, str]:
    return {field: '' for field in _METADATA_FIELDS}


def _load_department_names() -> list[dict[str, str]]:
    """Department vocabulary for the local pass and the prompt.

    Active only, and carrying the prose `title` the matcher needs. An archived
    college is rejected by services/catalog.py::resolve_academic_selection with
    422, so offering one to the form autofills a value the upload cannot use;
    blank is the better answer. Ordered so a tie between two colleges resolves
    the same way on every host instead of following row order.
    """
    rows = (
        sb.table('departments').select('name,title')
        .eq('active', True).order('name').execute().data
    )
    return (
        [{'name': row['name'], 'title': row.get('title') or ''} for row in rows]
        if rows else [{'name': 'CCSICT', 'title': ''}]
    )


def _metadata_llm() -> ChatGoogleGenerativeAI:
    # Bounded like the chat client: metadata extraction runs during an upload,
    # so an unbounded call would hold the request open indefinitely.
    return ChatGoogleGenerativeAI(
        model=settings.gemini_chat_model,
        google_api_key=settings.gemini_api_key,
        timeout=settings.gemini_timeout_seconds,
        max_retries=settings.gemini_max_retries,
        max_output_tokens=settings.gemini_max_output_tokens,
    )


async def _title_pages(file: UploadFile) -> tuple[str, str]:
    """Validate the upload and return (joined title-page text, first page).

    Use the title page as the authoritative source for bibliographic fields.
    Later pages are context for Gemini, but their citation years must never be
    mistaken for the thesis completion year.
    """
    file_bytes = await _read_limited_upload(file)
    await asyncio.to_thread(
        _validate_pdf_upload, file_bytes, file.filename, file.content_type,
    )
    page_texts = await asyncio.to_thread(_title_page_texts, file_bytes)
    return '\n'.join(page_texts), (page_texts[0] if page_texts else '')


async def _ai_completion(
    local_data: dict[str, str], text: str, title_page_text: str,
    dept_names: Sequence[Mapping[str, str]],
) -> dict[str, str]:
    """Fill the fields the local pass missed; on any failure keep the local data."""
    codes = [record['name'] for record in _department_records(dept_names)]
    dept_str = ', '.join(f'"{code}"' for code in codes)
    try:
        # The manuscript is third-party text: a thesis is student-authored and
        # the uploader is rarely its author, so "an administrator uploaded it"
        # is not the same as "an administrator wrote it". Escaped and fenced
        # like every other prompt that embeds document text, and the reply is
        # json.loads-ed, so a steered response is parsed rather than read.
        prompt = prompts.metadata_extraction_prompt(text, dept_str)
        result = await gemini_pool.arun(
            _metadata_llm(), gemini_pool.EXTRACT, lambda client: client.ainvoke(prompt),
        )
        data = json.loads(strip_code_fence(coerce_text(result)))

        ai_year = _as_text(data.get('year'))
        if ai_year and not re.search(rf'\b{re.escape(ai_year)}\b', title_page_text):
            ai_year = ''
        return {
            'title': _as_text(data.get('title'), local_data['title']),
            'authors': _as_text(
                _normalize_author_field(data.get('authors')), local_data['authors'],
            ),
            'year': local_data['year'] or ai_year,
            'department': (
                _canonical_department(_as_text(data.get('department')), dept_names)
                or local_data['department']
            ),
        }
    except Exception as e:
        logger.exception('Metadata extraction failed (%s)', type(e).__name__)
        return local_data


async def _extract_one(
    file: UploadFile, dept_names: Sequence[Mapping[str, str]] | None = None,
) -> dict[str, str]:
    """Local title-page pass first; Gemini only for what it leaves blank."""
    text, title_page_text = await _title_pages(file)
    if not text.strip():
        return {'title': '', 'authors': ''}
    if dept_names is None:
        dept_names = await asyncio.to_thread(_load_department_names)
    local_data = _extract_title_page_metadata(title_page_text, dept_names)
    if all(local_data.get(field) for field in _METADATA_FIELDS):
        return local_data
    return await _ai_completion(local_data, text, title_page_text, dept_names)


@router.post('/extract-metadata', responses=errors(400, 413, 415, 422))
@limiter.limit(settings.rate_limit_upload)
async def extract_metadata(
    request: Request,
    file: Annotated[UploadFile, File()],
    user: UploadUser,
):
    """Extract thesis metadata locally, with Gemini filling missing fields."""
    # As in upload_paper: PDF parsing, the department read, and the Gemini call
    # must not run on the event loop, or one metadata autofill freezes the API.
    try:
        return await _extract_one(file)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Metadata extraction failed (%s)', type(e).__name__)
        return _empty_metadata()


def _extracted_file(index: int, filename: str, data: dict[str, str] | None = None,
                    **extra) -> BatchExtractedFile:
    fields = {field: str((data or {}).get(field) or '') for field in _METADATA_FIELDS}
    return BatchExtractedFile(index=index, filename=filename, **fields, **extra)


@router.post(
    '/batch/extract-metadata', response_model=BatchExtractResponse,
    responses=errors(400, 403, 413, 422),
)
@limiter.limit(settings.rate_limit_upload)
async def extract_metadata_batch(
    request: Request,
    files: Annotated[list[UploadFile], File()],
    user: UploadUser,
):
    """Extract metadata for every file of a batch in one request.

    Files are read one at a time (only their title-page text is kept), then
    the Gemini completions for the incomplete ones run under a small
    semaphore. A file that fails validation is reported in place with its
    HTTP-like status so the client can drop that row and keep the rest.
    """
    _check_batch_size(files)
    dept_names = await asyncio.to_thread(_load_department_names)
    results: list[BatchExtractedFile | None] = [None] * len(files)
    pending: list[tuple[int, str, dict[str, str], str, str]] = []
    for index, file in enumerate(files):
        filename = _batch_filename(file, index)
        try:
            text, title_page_text = await _title_pages(file)
        except HTTPException as error:
            results[index] = _extracted_file(
                index, filename, error=str(error.detail), status_code=error.status_code,
            )
            continue
        except Exception as error:
            logger.exception('Batch metadata extraction failed for file %d (%s)', index, type(error).__name__)
            results[index] = _extracted_file(index, filename)
            continue
        if not text.strip():
            results[index] = _extracted_file(index, filename)
            continue
        local_data = _extract_title_page_metadata(title_page_text, dept_names)
        if all(local_data.get(field) for field in _METADATA_FIELDS):
            results[index] = _extracted_file(index, filename, local_data)
            continue
        pending.append((index, filename, local_data, text, title_page_text))

    semaphore = asyncio.Semaphore(_EXTRACT_CONCURRENCY)

    async def complete(index: int, filename: str, local_data: dict[str, str], text: str, first_page: str) -> None:
        async with semaphore:
            data = await _ai_completion(local_data, text, first_page, dept_names)
        results[index] = _extracted_file(index, filename, data)

    await asyncio.gather(*(complete(*entry) for entry in pending))
    return BatchExtractResponse(files=[result for result in results if result is not None])
