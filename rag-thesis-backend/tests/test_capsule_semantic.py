"""Whole-document capsule classification and its source-grounding boundary."""

import json
from types import SimpleNamespace

from services import capsule_semantic


SOURCE = """A Smart Irrigation Adviser
Farmers lose crops because watering decisions rely on guesswork.
The project will reduce water waste and improve crop survival.
Interviews with farmers will identify decision requirements.
The prototype will be evaluated using task completion and accuracy."""


def _fallback():
    return {
        'title': 'A Smart Irrigation Adviser',
        'rationale': '',
        'objectives': '',
        'methodology': '',
        'detected_sections': [],
    }


def _run_immediate(coroutine) -> dict:
    """Drive a fully mocked coroutine without creating a Windows event loop."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        assert isinstance(completed.value, dict)
        return completed.value
    raise AssertionError('The mocked semantic call unexpectedly yielded')


def test_grounding_accepts_meaning_based_source_sentences_without_headings():
    payload = {
        'title': 'A Smart Irrigation Adviser',
        'rationale': 'Farmers lose crops because watering decisions rely on guesswork.',
        'objectives': 'The project will reduce water waste and improve crop survival.',
        'methodology': 'Interviews with farmers will identify decision requirements.\n'
                       'The prototype will be evaluated using task completion and accuracy.',
    }
    assert capsule_semantic.grounded_capsule_payload(payload, SOURCE) == payload


def test_grounding_discards_invented_content_and_duplicate_assignments():
    sentence = 'The project will reduce water waste and improve crop survival.'
    result = capsule_semantic.grounded_capsule_payload({
        'title': 'A Smart Irrigation Adviser',
        'rationale': sentence,
        'objectives': f'{sentence}\nThis was never in the document.',
        'methodology': '',
    }, SOURCE)
    assert result['rationale'] == sentence
    assert result['objectives'] == ''


def test_grounding_rejects_an_unexpected_json_shape():
    result = capsule_semantic.grounded_capsule_payload({'title': 'A title'}, SOURCE)
    assert result == {'title': '', 'rationale': '', 'objectives': '', 'methodology': ''}


def test_semantic_analysis_merges_supported_meaning_with_local_fallback(monkeypatch):
    payload = {
        'title': 'A Smart Irrigation Adviser',
        'rationale': 'Farmers lose crops because watering decisions rely on guesswork.',
        'objectives': 'The project will reduce water waste and improve crop survival.',
        'methodology': 'Interviews with farmers will identify decision requirements.',
    }

    async def fake_arun(_primary, _kind, call):
        class Client:
            async def ainvoke(self, _prompt):
                return SimpleNamespace(content=json.dumps(payload))
        return await call(Client())

    monkeypatch.setattr(capsule_semantic.gemini_pool, 'arun', fake_arun)
    monkeypatch.setattr(capsule_semantic, '_llm', object)
    result = dict(_run_immediate(capsule_semantic.analyze_capsule(SOURCE, _fallback())))
    assert result['extraction_method'] == 'semantic'
    assert result['objectives'] == payload['objectives']
    assert result['detected_sections'] == ['title', 'rationale', 'objectives', 'methodology']


def test_provider_failure_keeps_heading_extraction(monkeypatch):
    async def unavailable(*_args, **_kwargs):
        raise TimeoutError('provider unavailable')

    fallback = _fallback()
    fallback['rationale'] = 'Locally extracted rationale.'
    monkeypatch.setattr(capsule_semantic.gemini_pool, 'arun', unavailable)
    monkeypatch.setattr(capsule_semantic, '_llm', object)
    result = dict(_run_immediate(capsule_semantic.analyze_capsule(SOURCE, fallback)))
    assert result['extraction_method'] == 'headings'
    assert result['rationale'] == 'Locally extracted rationale.'
