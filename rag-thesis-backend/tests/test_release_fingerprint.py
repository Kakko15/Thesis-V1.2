"""PI-03 release provenance tests."""

from scripts.release_fingerprint import ROOT, build_manifest, gateway_host, sha256_file
from config import Settings, settings


def test_release_manifest_captures_exact_models_index_and_locks():
    manifest = build_manifest()
    assert manifest['models']['chat'] == settings.gemini_chat_model
    assert manifest['models']['verdict'] == settings.gemini_verdict_model
    assert manifest['models']['embedding'] == settings.gemini_embed_model
    assert Settings.model_fields['gemini_chat_model'].default == 'gemini-3.6-flash'
    assert Settings.model_fields['gemini_verdict_model'].default == 'gemini-3.5-flash-lite'
    assert Settings.model_fields['gemini_timeout_seconds'].default == 60.0
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


def test_the_manifest_records_which_provider_served_generation(monkeypatch):
    """A gateway must change the fingerprint, or Section 3.2.1's claim is false.

    LLM_BASE_URL routes every chat, extract and verdict call away from Google
    while leaving the model names, the generation contract and the RAG contract
    untouched. Without this field two runs on different providers produce
    identical manifests, and the paper's "one exact configuration" guarantee
    silently stops holding.
    """
    monkeypatch.setattr(settings, 'llm_base_url', '')
    direct = build_manifest()
    assert direct['generation_route']['gateway_enabled'] is False
    assert direct['generation_route']['gateway_host'] is None

    monkeypatch.setattr(settings, 'llm_base_url', 'https://gateway.example:8443/v1')
    routed = build_manifest()
    assert routed['generation_route']['gateway_enabled'] is True
    assert routed['generation_route']['gateway_host'] == 'gateway.example'
    assert routed['generation_route'] != direct['generation_route']

    # Adding a field changed the artifact's shape, so the version has to move
    # with it; a reader comparing two manifests must be able to tell which
    # schema each one was written under.
    assert routed['schema_version'] == 3


def test_the_manifest_records_the_bounds_that_decide_a_severed_reply(monkeypatch):
    """The gateway's reasoning and output bounds decide whether a reply completes.

    `thinking_level` cannot cross an OpenAI-compatible boundary, so the gateway
    carries its own effort and ceiling. A run served with them unset produced
    severed answers while the same question completed against Google, which
    makes them part of the configuration a result is attributable to, not
    deployment trivia.
    """
    monkeypatch.setattr(settings, 'llm_base_url', '')
    direct = build_manifest()['generation_route']
    assert direct['gateway_max_output_tokens'] is None
    assert direct['gateway_reasoning_effort'] is None

    monkeypatch.setattr(settings, 'llm_base_url', 'https://gateway.example/v1')
    monkeypatch.setattr(settings, 'llm_gateway_max_output_tokens', 6000)
    monkeypatch.setattr(settings, 'gemini_thinking_level', 'low')
    routed = build_manifest()['generation_route']
    assert routed['gateway_max_output_tokens'] == 6000
    assert routed['gateway_reasoning_effort'] == 'low'


def test_the_manifest_never_carries_the_gateway_credential(monkeypatch):
    """The manifest is committed and shown to a panel; the key must not be in it."""
    monkeypatch.setattr(
        settings, 'llm_base_url', 'https://user:s3cr3t@gateway.example/v1?token=leak',
    )
    monkeypatch.setattr(settings, 'llm_api_key', 'sk-must-never-appear')
    serialized = repr(build_manifest())
    assert 'sk-must-never-appear' not in serialized
    assert 's3cr3t' not in serialized
    assert 'leak' not in serialized
    # Host only: userinfo, port, path and query are all discarded.
    assert gateway_host() == 'gateway.example'
