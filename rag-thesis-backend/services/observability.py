"""Privacy-safe LangSmith spans for RAG performance evaluation."""

from contextlib import asynccontextmanager

from config import settings


@asynccontextmanager
async def safe_trace(name: str, *, metadata: dict | None = None):
    """Create a metadata-only trace; never pass prompts or manuscript text."""
    if not settings.effective_langsmith_tracing or not settings.effective_langsmith_api_key:
        yield None
        return

    from langsmith.run_helpers import trace

    safe_metadata = {
        key: value for key, value in (metadata or {}).items()
        if isinstance(value, (str, int, float, bool, type(None)))
    }
    async with trace(
        name,
        run_type='chain',
        inputs={'content_hidden': True},
        project_name=settings.effective_langsmith_project,
        metadata=safe_metadata,
        tags=['thesis-evaluation', 'privacy-safe'],
    ) as run:
        yield run
