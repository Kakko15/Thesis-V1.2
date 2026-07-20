"""Server-owned embedding and document-index provenance."""

from config import settings
from services.chunker import CHUNKING_VERSION, TOKENIZER_ENCODING

PREPROCESSING_VERSION = 'document-v1'
PROVENANCE_STATUS_VERIFIED = 'verified'
PROVENANCE_STATUS_LEGACY = 'legacy_assumed'


def current_index_fingerprint() -> dict:
    """Return the deterministic fingerprint written for newly built indexes."""
    return {
        'embedding_model': settings.gemini_embed_model,
        'embedding_dimensions': settings.embedding_dimensions,
        'preprocessing_version': PREPROCESSING_VERSION,
        'chunking_version': CHUNKING_VERSION,
        'tokenizer': TOKENIZER_ENCODING,
        'chunk_size_tokens': settings.chunk_size_tokens,
        'chunk_overlap_tokens': settings.chunk_overlap_tokens,
        'provenance_status': PROVENANCE_STATUS_VERIFIED,
    }


def retrieval_provenance_params() -> dict:
    """RPC parameters that prevent cross-embedding-space retrieval."""
    return {
        'p_embedding_model': settings.gemini_embed_model,
        'p_embedding_dimensions': settings.embedding_dimensions,
    }


def is_embedding_compatible(index: dict | None) -> bool:
    """Compatibility depends on vector model and dimensions, not chunk layout."""
    return bool(
        index
        and index.get('embedding_model') == settings.gemini_embed_model
        and index.get('embedding_dimensions') == settings.embedding_dimensions
        and index.get('provenance_status') in {
            PROVENANCE_STATUS_VERIFIED,
            PROVENANCE_STATUS_LEGACY,
        }
    )
