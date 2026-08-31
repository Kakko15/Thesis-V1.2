"""ISU Centralized AI-Powered Thesis Library — FastAPI application.

Run (development):  uvicorn main:app --reload --port 8000
Run (production):   uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import settings
from services.rate_limiting import limiter
from services.safe_logging import configure_safe_logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
configure_safe_logging()
logger = logging.getLogger('thesis-library')

# Optional LangSmith tracing (Performance Efficiency, ISO/IEC 25010)
if settings.effective_langsmith_tracing:
    os.environ.setdefault('LANGSMITH_TRACING', str(settings.effective_langsmith_tracing).lower())
    os.environ.setdefault('LANGSMITH_API_KEY', settings.effective_langsmith_api_key)
    os.environ.setdefault('LANGSMITH_PROJECT', settings.effective_langsmith_project)
    os.environ.setdefault('LANGSMITH_HIDE_INPUTS', str(settings.langsmith_hide_inputs).lower())
    os.environ.setdefault('LANGSMITH_HIDE_OUTPUTS', str(settings.langsmith_hide_outputs).lower())
    # Temporary compatibility for older LangChain integrations.
    os.environ.setdefault('LANGCHAIN_TRACING_V2', str(settings.effective_langsmith_tracing).lower())
    os.environ.setdefault('LANGCHAIN_API_KEY', settings.effective_langsmith_api_key)
    os.environ.setdefault('LANGCHAIN_PROJECT', settings.effective_langsmith_project)

from routers import analytics, catalog, chat, departments, duplication, maintenance, papers, sessions, upload
from routers import settings as settings_router


_OPERATIONS_STATE: dict[str, object] = {'thread': None, 'stop': None}


def _operations_monitor(stop: threading.Event) -> None:
    """Evaluate operational health until this generation's own event is set."""
    from dependencies.auth import sb
    from services.operations import evaluate_operations

    while not stop.is_set():
        try:
            evaluate_operations(sb)
        except Exception as error:
            logger.warning('Operations monitor failed (%s)', type(error).__name__)
        stop.wait(settings.operations_monitor_seconds)


def start_operations_monitor() -> None:
    """Start the monitor unless one is enabled-and-running already.

    Each generation gets its **own** stop event, passed to the thread rather
    than read from module scope. A single shared event meant a restart called
    `clear()` on the event the previous thread was still watching — which
    un-cancelled it — and then started a second thread. Both would race on
    `upsert_alert` / `resolve_alert` and an alert could flap between open and
    resolved.
    """
    if not settings.operations_monitor_enabled:
        return
    existing = _OPERATIONS_STATE['thread']
    if isinstance(existing, threading.Thread) and existing.is_alive():
        return
    stop = threading.Event()
    thread = threading.Thread(target=_operations_monitor, args=(stop,), daemon=True)
    _OPERATIONS_STATE['stop'] = stop
    _OPERATIONS_STATE['thread'] = thread
    thread.start()


def stop_operations_monitor() -> None:
    """Signal the monitor and forget it only once it has actually stopped.

    `Event.wait` is interruptible, so a thread parked between cycles exits
    immediately. The gap this closes is the other case: a thread inside
    `evaluate_operations()` for more than the join timeout — realistic, since
    `notify_webhook` retries three times with its own httpx timeout on each.
    The handle used to be cleared regardless, which is what let a second thread
    start alongside the first.
    """
    stop = _OPERATIONS_STATE['stop']
    if isinstance(stop, threading.Event):
        stop.set()
    thread = _OPERATIONS_STATE['thread']
    if isinstance(thread, threading.Thread):
        thread.join(timeout=2)
        if thread.is_alive():
            # Still inside a cycle. Its own event stays set, so it will exit at
            # the end of this one; keeping the handle means the next start()
            # declines rather than racing a second monitor against it.
            logger.warning(
                'Operations monitor did not stop within 2s; leaving it to finish its cycle',
            )
            return
    _OPERATIONS_STATE['thread'] = None
    _OPERATIONS_STATE['stop'] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Own the operations monitor's whole lifecycle as one scoped unit.

    Replaces the `@app.on_event('startup')` / `('shutdown')` pair, deprecated
    since Starlette 0.26 / FastAPI 0.93 and slated for removal; on 0.139.2 each
    one emitted a DeprecationWarning at every application start. Starting and
    stopping the monitor are two halves of a single lifecycle, which one
    context manager expresses and two independent hooks cannot — the stop now
    runs even if startup work later raises.
    """
    start_operations_monitor()
    try:
        yield
    finally:
        stop_operations_monitor()


app = FastAPI(
    title='ISU Thesis AI Library API',
    description=(
        'Centralized AI-Powered Thesis Library using Retrieval-Augmented Generation '
        'for the College of Computing Studies, Information and Communication Technology, '
        'Isabela State University, Echague.'
    ),
    version='2.1.0',
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Compress large JSON responses (archive listings, RAG answers)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware('http')
async def security_headers(request: Request, call_next):
    """Add baseline OWASP security response headers."""
    response = await call_next(request)
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'no-referrer')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if request.url.scheme == 'https':
        response.headers.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return response


# Registered last on purpose. Starlette applies middleware in reverse
# registration order, so this leaves CORS as the OUTERMOST layer and every
# response carries its headers - including rate-limit rejections and errors
# raised inside the inner middleware. Otherwise the browser reports those as
# opaque cross-origin failures instead of the real status.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allow_headers=['Authorization', 'Content-Type', 'X-Guest-ID', 'Idempotency-Key', 'X-Turnstile-Token'],
    # The guest-chat guard signals "solve the challenge" via this header.
    expose_headers=['X-Guest-Verification'],
)


app.include_router(upload.router)
app.include_router(chat.router)
app.include_router(papers.router)
app.include_router(sessions.router)
app.include_router(duplication.router)
app.include_router(analytics.router)
app.include_router(departments.router)
app.include_router(catalog.router)
app.include_router(settings_router.router)
app.include_router(maintenance.router)


_CONTRACT_CACHE_TTL_SECONDS = 15.0
_CONTRACT_CACHE: dict[str, float | bool] = {'checked_at': 0.0, 'ok': False}


def _cached_database_contract() -> bool:
    """Report schema health for `/health`, re-checking at most every 15 seconds.

    `/health` is unauthenticated and `_verify_database_contract` issues four
    separate reads, so the global 120/minute default permitted 480 database
    reads per minute per caller — the same denial-of-wallet shape that
    `rate_limit_public` was introduced for on the public summary and catalog
    endpoints. The frontend also polls this every 30 seconds per open tab.

    A named 30/minute limit was the obvious fix and is the wrong one here:
    legitimate traffic would breach it (sixteen tabs behind one campus NAT poll
    32 times a minute), and the badge would start reporting a healthy system as
    degraded. Caching the contract instead removes the amplification at the
    source — 120 requests a minute now cost at most four reads per 15-second
    window — and leaves real polling untouched.

    `/ready` deliberately does NOT use this. It gates whether traffic should
    reach this instance, so a stale `ready` could route requests to a broken
    process; it keeps paying for the exact answer.
    """
    now = time.monotonic()
    if now - float(_CONTRACT_CACHE['checked_at']) < _CONTRACT_CACHE_TTL_SECONDS:
        return bool(_CONTRACT_CACHE['ok'])
    try:
        _verify_database_contract()
        healthy = True
    except Exception as error:
        logger.warning(
            'Health check: database unavailable or incompatible (%s)',
            type(error).__name__,
        )
        healthy = False
    _CONTRACT_CACHE['checked_at'] = now
    _CONTRACT_CACHE['ok'] = healthy
    return healthy


def reset_contract_cache() -> None:
    """Test hook: force the next `/health` call to re-check the schema."""
    _CONTRACT_CACHE['checked_at'] = 0.0
    _CONTRACT_CACHE['ok'] = False


def _verify_database_contract() -> None:
    """Fail when the configured project is reachable but lacks required schema."""
    from dependencies.auth import sb

    sb.table('profiles').select('id,status,role,department').limit(1).execute()
    sb.table('departments').select('id,name').limit(1).execute()
    sb.table('papers').select(
        'id,department,ingestion_status,active_index_version',
    ).limit(1).execute()
    sb.table('paper_index_versions').select(
        'paper_id,index_version,embedding_model,embedding_dimensions,'
        'preprocessing_version,chunking_version,provenance_status',
    ).limit(1).execute()


@app.get('/health')
def health():
    """Return liveness and dependency status."""
    checks = {
        'api': 'ok',
        'database': 'ok' if _cached_database_contract() else 'unavailable_or_incompatible',
    }
    status = 'ok' if all(value == 'ok' for value in checks.values()) else 'degraded'
    return {'status': status, 'checks': checks, 'version': app.version}


@app.get('/health/worker')
def worker_health():
    """Expose only generic worker availability for portable uptime monitoring."""
    from datetime import datetime, timedelta, timezone
    from dependencies.auth import sb

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(seconds=settings.operations_worker_stale_seconds)
    ).isoformat()
    try:
        rows = (
            sb.table('ingestion_workers').select('state,scanner_status,last_seen_at')
            .gte('last_seen_at', cutoff).neq('state', 'stopping').limit(1).execute().data or []
        )
        healthy = bool(rows and rows[0].get('scanner_status') != 'unavailable')
    except Exception:
        healthy = False
    payload = {'status': 'healthy' if healthy else 'degraded'}
    return JSONResponse(payload, status_code=200 if healthy else 503)


@app.get('/ready')
def readiness():
    """Return 503 until required backend dependencies can serve requests."""
    checks = {
        'database': 'unreachable',
        'ai_configuration': 'ok' if settings.gemini_api_key else 'missing',
        'rate_limit_store': (
            'ok'
            if settings.app_environment != 'production'
            or not settings.rate_limit_storage_uri.startswith('memory://')
            else 'misconfigured'
        ),
    }
    try:
        _verify_database_contract()
        checks['database'] = 'ok'
    except Exception as error:
        logger.warning('Readiness check: database unavailable or incompatible: %s', type(error).__name__)
        checks['database'] = 'unavailable_or_incompatible'
    ready = all(value == 'ok' for value in checks.values())
    payload = {
        'status': 'ready' if ready else 'not_ready',
        'checks': checks,
        'version': app.version,
    }
    return JSONResponse(payload, status_code=200 if ready else 503)
