"""ISU Centralized AI-Powered Thesis Library — FastAPI application.

Run (development):  uvicorn main:app --reload --port 8000
Run (production):   uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import settings
from services.rate_limiting import limiter

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
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

from routers import analytics, chat, departments, duplication, maintenance, papers, sessions, upload
from routers import settings as settings_router


app = FastAPI(
    title='ISU Thesis AI Library API',
    description=(
        'Centralized AI-Powered Thesis Library using Retrieval-Augmented Generation '
        'for the College of Computing Studies, Information and Communication Technology, '
        'Isabela State University, Echague.'
    ),
    version='2.0.0',
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allow_headers=['Authorization', 'Content-Type', 'X-Guest-ID'],
)

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


app.include_router(upload.router)
app.include_router(chat.router)
app.include_router(papers.router)
app.include_router(sessions.router)
app.include_router(duplication.router)
app.include_router(analytics.router)
app.include_router(departments.router)
app.include_router(settings_router.router)
app.include_router(maintenance.router)


def _verify_database_contract() -> None:
    """Fail when the configured project is reachable but lacks required schema."""
    from dependencies.auth import sb

    sb.table('profiles').select('id,status,role,department').limit(1).execute()
    sb.table('departments').select('id,name').limit(1).execute()
    sb.table('papers').select(
        'id,department,ingestion_status,active_index_version',
    ).limit(1).execute()


@app.get('/health')
def health():
    """Return liveness and dependency status."""
    checks = {'api': 'ok'}
    try:
        _verify_database_contract()
        checks['database'] = 'ok'
    except Exception as error:
        logger.warning('Health check: database unavailable or incompatible (%s)', type(error).__name__)
        checks['database'] = 'unavailable_or_incompatible'
    status = 'ok' if all(value == 'ok' for value in checks.values()) else 'degraded'
    return {'status': status, 'checks': checks, 'version': app.version}


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
