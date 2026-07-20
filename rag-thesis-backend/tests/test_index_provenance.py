"""Index fingerprint and embedding-space compatibility tests."""

import pytest
from pydantic import ValidationError

from config import Settings, settings
from services.index_provenance import (
    current_index_fingerprint,
    is_embedding_compatible,
    retrieval_provenance_params,
)


def test_current_fingerprint_is_complete_and_server_owned():
    assert current_index_fingerprint() == {
        'embedding_model': settings.gemini_embed_model,
        'embedding_dimensions': 768,
        'preprocessing_version': 'document-v1',
        'chunking_version': 'token-v1',
        'tokenizer': 'cl100k_base',
        'chunk_size_tokens': 800,
        'chunk_overlap_tokens': 100,
        'provenance_status': 'verified',
    }
    assert retrieval_provenance_params() == {
        'p_embedding_model': settings.gemini_embed_model,
        'p_embedding_dimensions': 768,
    }


@pytest.mark.parametrize('status', ['verified', 'legacy_assumed'])
def test_verified_and_known_legacy_indexes_remain_readable(status):
    assert is_embedding_compatible({
        'embedding_model': settings.gemini_embed_model,
        'embedding_dimensions': 768,
        'provenance_status': status,
    })


@pytest.mark.parametrize('index', [
    None,
    {},
    {'embedding_model': 'another-model', 'embedding_dimensions': 768,
     'provenance_status': 'verified'},
    {'embedding_model': 'models/gemini-embedding-2', 'embedding_dimensions': 3072,
     'provenance_status': 'verified'},
    {'embedding_model': 'models/gemini-embedding-2', 'embedding_dimensions': 768,
     'provenance_status': 'unknown'},
])
def test_unknown_or_incompatible_indexes_are_rejected(index):
    assert not is_embedding_compatible(index)


def test_vector_dimensions_cannot_change_by_environment_only():
    values = {
        'gemini_api_key': 'test', 'supabase_url': 'https://example.supabase.co',
        'supabase_key': 'test', 'embedding_dimensions': 3072,
    }
    with pytest.raises(ValidationError):
        Settings(**values)
