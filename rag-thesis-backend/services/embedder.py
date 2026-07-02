"""Embedding Layer — Gemini embeddings at 768 dimensions (paper, Figure 8).

Adds production batching with exponential-backoff retry so a single
transient API failure never aborts a full thesis ingestion.
"""

import logging
import time

from langchain_google_genai import GoogleGenerativeAIEmbeddings

from config import settings

logger = logging.getLogger(__name__)

_BATCH_SIZE = 64
_MAX_RETRIES = 3
_BACKOFF_BASE_SECONDS = 2.0

embeddings_model = GoogleGenerativeAIEmbeddings(
    model=settings.gemini_embed_model,
    google_api_key=settings.gemini_api_key,
    output_dimensionality=settings.embedding_dimensions,
)


def _with_retry(fn, *args):
    last_error = None
    for attempt in range(_MAX_RETRIES):
        try:
            return fn(*args)
        except Exception as e:  # transient API/network failures
            last_error = e
            wait = _BACKOFF_BASE_SECONDS * (2 ** attempt)
            logger.warning('Embedding call failed (attempt %d/%d): %s — retrying in %.1fs',
                           attempt + 1, _MAX_RETRIES, e, wait)
            time.sleep(wait)
    logger.error('Embedding generation failed after %d attempts: %s', _MAX_RETRIES, last_error)
    raise last_error


def embed_text(text: str) -> list[float]:
    """Vector embedding for a single string (e.g. a search query)."""
    return _with_retry(embeddings_model.embed_query, text)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Vector embeddings for document chunks, processed in batches."""
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        batch = texts[start:start + _BATCH_SIZE]
        vectors.extend(_with_retry(embeddings_model.embed_documents, batch))
    return vectors
