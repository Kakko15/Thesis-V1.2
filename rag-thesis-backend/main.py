"""ISU Centralized AI-Powered Thesis Library — FastAPI application.

Run (development):  uvicorn main:app --reload --port 8000
Run (production):   uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
import os

import jwt  # PyJWT (dependency of supabase-auth)
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from config import settings

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s [%(name)s] %(message)s',
)
logger = logging.getLogger('thesis-library')

# Optional LangSmith tracing (Performance Efficiency, ISO/IEC 25010)
if settings.langchain_tracing_v2:
    os.environ.setdefault('LANGCHAIN_TRACING_V2', settings.langchain_tracing_v2)
    os.environ.setdefault('LANGCHAIN_API_KEY', settings.langchain_api_key)
    os.environ.setdefault('LANGCHAIN_PROJECT', settings.langchain_project)

from routers import analytics, chat, duplication, papers, sessions, upload, departments
from routers import settings as settings_router


def rate_limit_key(request: Request) -> str:
    """Rate-limit bucket key: verified user id when possible, else client IP.

    The Supabase JWT signature MUST verify (HS256 against
    SUPABASE_JWT_SECRET) before the user id is trusted — an unverified
    claim would let forged tokens mint unlimited fresh buckets.
    """
    if settings.supabase_jwt_secret:
        auth = request.headers.get('authorization', '')
        if auth.lower().startswith('bearer '):
            try:
                claims = jwt.decode(
                    auth[7:],
                    settings.supabase_jwt_secret,
                    algorithms=['HS256'],
                    audience='authenticated',
                )
                if claims.get('sub'):
                    return f"user:{claims['sub']}"
            except jwt.InvalidTokenError:
                pass  # unverifiable token -> fall back to IP bucket
    return get_remote_address(request)


limiter = Limiter(key_func=rate_limit_key, default_limits=['120/minute'])

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
    allow_headers=['Authorization', 'Content-Type'],
)

# Compress large JSON responses (archive listings, RAG answers)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware('http')
async def security_headers(request: Request, call_next):
    """Baseline security response headers (OWASP secure headers)."""
    response = await call_next(request)
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'no-referrer')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    return response

app.include_router(upload.router)
app.include_router(chat.router)
app.include_router(papers.router)
app.include_router(sessions.router)
app.include_router(duplication.router)
app.include_router(analytics.router)
app.include_router(departments.router)
app.include_router(settings_router.router)


@app.get('/health')
def health(request: Request):
    """Liveness + dependency check."""
    checks = {'api': 'ok'}
    try:
        from dependencies.auth import sb
        sb.table('papers').select('id').limit(1).execute()
        checks['database'] = 'ok'
    except Exception as e:
        logger.warning('Health check: database unreachable: %s', e)
        checks['database'] = 'unreachable'
    status = 'ok' if all(v == 'ok' for v in checks.values()) else 'degraded'
    return {'status': status, 'checks': checks, 'version': app.version}
