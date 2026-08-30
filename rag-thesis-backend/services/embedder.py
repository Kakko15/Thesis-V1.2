"""Embedding layer — Gemini embeddings at 768 dimensions (paper, Figure 8).

Adds production batching with exponential-backoff retry so a single
transient API failure never aborts a full thesis ingestion.
"""

import logging

from langchain_google_genai import GoogleGenerativeAIEmbeddings

from config import settings
from services.network_retry import retry_transient
from services import gemini_pool

logger = logging.getLogger(__name__)

_BATCH_SIZE = 64
_MAX_RETRIES = 3
_BACKOFF_BASE_SECONDS = 0.5

embeddings_model = GoogleGenerativeAIEmbeddings(
    model=settings.gemini_embed_model,
    google_api_key=settings.gemini_api_key,
    output_dimensionality=settings.embedding_dimensions,
)


def _with_retry(fn, *args):
    return retry_transient(
        lambda: fn(*args),
        label='Gemini embedding',
        attempts=_MAX_RETRIES,
        base_delay_seconds=_BACKOFF_BASE_SECONDS,
        logger=logger,
    )


def embed_text(text: str) -> list[float]:
    """Vector embedding for a single string (for example, a search query)."""
    return gemini_pool.run(
        embeddings_model, gemini_pool.EMBED,
        lambda client: _with_retry(client.embed_query, text),
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Vector embeddings for document chunks, processed in batches."""
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        batch = texts[start : start + _BATCH_SIZE]
        vectors.extend(gemini_pool.run(
            embeddings_model, gemini_pool.EMBED,
            lambda client, chunk=batch: _with_retry(client.embed_documents, chunk),
        ))
    return vectors
