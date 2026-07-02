"""Admin paper ingestion (thesis paper, Section 3.3 — Document Processing System).

Pipeline stages: extract (PyMuPDF + OCR fallback) -> clean (regex GIGO
mitigation) -> chunk (800-token / 100-token overlap) -> embed (Gemini,
768d) -> index (Supabase pgvector + metadata tagging).

Runs as a background job with a polleable status endpoint so the admin UI
can display live pipeline progress. Original PDFs are stored in the
PRIVATE `pdfs` bucket — never publicly reachable (indirect access model).
"""

import logging
import mimetypes
import threading
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from config import settings
from dependencies.auth import require_admin, sb
from models import CCSICT_TRACKS, UploadAccepted, UploadJobStatus
from services.activity import log_activity
from services.chunker import build_chunk_metadata, split_text
from services.document_processor import extract_text, filter_noise_chunks
from services.embedder import embed_texts

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/upload', tags=['upload'])

# In-process job store (single uvicorn worker deployment)
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SECONDS = 3600


def _set_job(job_id: str, **updates):
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
            uploader_id: str):
    """Full ingestion pipeline executed in the background."""
    paper_id = None
    try:
        # Stage 1: Data digitization (extract + clean)
        _set_job(job_id, status='processing', stage='extract', progress=10,
                 message='Extracting and cleaning text (PyMuPDF + OCR fallback)...')
        content = extract_text(file_bytes, filename)
        if not content.strip():
            raise ValueError('Could not extract any text from the file')

        # Stage 2: Private storage of the original PDF
        _set_job(job_id, stage='store', progress=25, message='Archiving original file in private storage...')
        unique_filename = f'{uuid.uuid4()}_{filename}'
        content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        storage_path = None
        try:
            sb.storage.from_('pdfs').upload(unique_filename, file_bytes,
                                            file_options={'content-type': content_type})
            storage_path = unique_filename
        except Exception as e:
            logger.error('Private storage upload failed: %s', e)

        # Stage 3: Chunking (800-token / 100-token overlap) + noise filter
        _set_job(job_id, stage='chunk', progress=40,
                 message='Chunking manuscript (800-token windows, 100-token overlap)...')
        chunks = filter_noise_chunks(split_text(content))
        if not chunks:
            raise ValueError('The document contained no clean, indexable text after filtering')

        # Stage 4: Metadata row for the paper
        year_int = int(year) if str(year).isdigit() else None
        paper_data = {
            'title': title, 'authors': authors, 'year': year_int,
            'abstract': abstract, 'track': track, 'content': content,
            'filename': filename, 'storage_path': storage_path,
            'chunk_count': len(chunks), 'uploaded_by': uploader_id,
        }
        paper_res = sb.table('papers').insert(paper_data).execute()
        paper = paper_res.data[0]
        paper_id = paper['id']

        # Stage 5: Embedding (Gemini, 768 dimensions, batched)
        _set_job(job_id, stage='embed', progress=60,
                 message=f'Generating {len(chunks)} vector embeddings (Gemini, 768d)...')
        embeddings = embed_texts(chunks)

        # Stage 6: Semantic indexing with per-chunk metadata tagging
        _set_job(job_id, stage='index', progress=85, message='Indexing vectors in Supabase pgvector...')
        metadata = build_chunk_metadata(title, authors, track, year_int)
        chunk_rows = [
            {'paper_id': paper_id, 'chunk_index': i, 'content': chunk,
             'metadata': metadata, 'embedding': emb}
            for i, (chunk, emb) in enumerate(zip(chunks, embeddings))
        ]
        for start in range(0, len(chunk_rows), 100):
            sb.table('chunks').insert(chunk_rows[start:start + 100]).execute()

        _set_job(job_id, status='completed', stage='done', progress=100,
                 message='Thesis indexed successfully.', paper_id=paper_id, chunks=len(chunks))
        log_activity(uploader_id, 'paper_upload', {'paper_id': paper_id, 'title': title,
                                                   'track': track, 'chunks': len(chunks)})
    except Exception as e:
        logger.exception('Ingestion job %s failed', job_id)
        # Roll back the partial paper row so the archive never holds
        # un-indexed entries.
        if paper_id:
            try:
                sb.table('papers').delete().eq('id', paper_id).execute()
            except Exception:
                pass
        _set_job(job_id, status='failed', stage='error', progress=100,
                 message='Ingestion failed.', error=str(e))


@router.post('/paper', response_model=UploadAccepted, status_code=202)
async def upload_paper(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    authors: str = Form(''),
    year: str = Form(''),
    abstract: str = Form(''),
    track: str = Form(''),
    user=Depends(require_admin),
):
    if track and track not in CCSICT_TRACKS:
        raise HTTPException(422, f'Unknown CCSICT track. Valid tracks: {", ".join(CCSICT_TRACKS)}')

    file_bytes = await file.read()
    if len(file_bytes) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f'File exceeds the {settings.max_upload_mb} MB limit')
    if not file_bytes:
        raise HTTPException(400, 'Empty file')

    _prune_jobs()
    job_id = str(uuid.uuid4())
    _set_job(job_id, status='queued', stage='extract', progress=0,
             message='Queued for processing...')
    background_tasks.add_task(_ingest, job_id, file_bytes, file.filename,
                              title, authors, year, abstract, track, user.id)

    return UploadAccepted(job_id=job_id, status='queued',
                          message='Upload accepted. Poll /upload/status/{job_id} for progress.')


@router.get('/status/{job_id}', response_model=UploadJobStatus)
def upload_status(job_id: str, user=Depends(require_admin)):
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, 'Upload job not found (it may have expired)')
    return UploadJobStatus(
        job_id=job_id,
        status=job.get('status', 'queued'),
        stage=job.get('stage', ''),
        progress=job.get('progress', 0),
        message=job.get('message', ''),
        paper_id=job.get('paper_id'),
        chunks=job.get('chunks'),
        error=job.get('error'),
    )


@router.get('/tracks')
def list_tracks():
    """CCSICT academic tracks for the upload form and archive filters."""
    return {'tracks': CCSICT_TRACKS}
