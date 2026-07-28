"""PI-03 release provenance tests."""

from scripts.release_fingerprint import ROOT, build_manifest, sha256_file
from config import Settings, settings


def test_release_manifest_captures_exact_models_index_and_locks():
    manifest = build_manifest()
    assert manifest['models']['chat'] == settings.gemini_chat_model
    assert manifest['models']['verdict'] == settings.gemini_verdict_model
    assert manifest['models']['embedding'] == settings.gemini_embed_model
    assert Settings.model_fields['gemini_chat_model'].default == 'gemini-3.6-flash'
    assert Settings.model_fields['gemini_verdict_model'].default == 'gemini-3.5-flash-lite'
    assert manifest['generation_contract'] == {
        'timeout_seconds': settings.gemini_timeout_seconds,
        'max_retries': settings.gemini_max_retries,
        'max_output_tokens': settings.gemini_max_output_tokens,
        'thinking_level': settings.gemini_thinking_level,
    }
    assert manifest['index_fingerprint']['embedding_dimensions'] == 768
    assert manifest['rag_contract'] == {
        'chunk_size_tokens': settings.chunk_size_tokens,
        'chunk_overlap_tokens': settings.chunk_overlap_tokens,
        'retrieval_threshold': settings.retrieval_threshold,
        'retrieval_match_count': settings.retrieval_match_count,
        'duplication_threshold': settings.duplication_threshold,
        'evaluation_department': settings.thesis_evaluation_department,
    }
    lock = ROOT / 'rag-thesis-frontend' / 'package-lock.json'
    assert manifest['input_sha256']['rag-thesis-frontend/package-lock.json'] == sha256_file(lock)
    assert all(len(value) == 64 for value in manifest['input_sha256'].values())
