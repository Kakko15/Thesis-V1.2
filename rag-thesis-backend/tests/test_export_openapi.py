import hashlib
import json
from pathlib import Path

from scripts.export_openapi import render_openapi

CURRENT_CONTRACT = (
    Path(__file__).resolve().parents[2]
    / 'docs' / 'evidence' / 'contracts' / 'iskai-openapi.current.json'
)


def test_openapi_snapshot_is_deterministic_and_contains_catalog_contracts():
    first = render_openapi()
    second = render_openapi()
    assert first == second
    document = json.loads(first)
    assert document['openapi'].startswith('3.')
    assert '/catalog/departments' in document['paths']
    assert '/catalog/programs' in document['paths']
    assert '/catalog/specializations' in document['paths']
    assert hashlib.sha256(first.encode('utf-8')).hexdigest() == hashlib.sha256(
        second.encode('utf-8'),
    ).hexdigest()


def test_live_schema_matches_committed_current_contract():
    """API drift gate: the deployed schema must match the tracked contract.

    On an intentional API change, regenerate the contract and commit it with
    the change that caused it:

        python -m scripts.export_openapi ../docs/evidence/contracts/iskai-openapi.current.json

    Dated snapshots under docs/evidence/contracts/ are immutable point-in-time
    release evidence and are never rewritten by this gate.
    """
    committed = CURRENT_CONTRACT.read_text(encoding='utf-8')
    live = render_openapi()
    assert live == committed, (
        'The live OpenAPI schema no longer matches '
        'docs/evidence/contracts/iskai-openapi.current.json. If this change is '
        'intentional, regenerate the contract (see this test\'s docstring) and '
        'commit it together with the API change.'
    )


def test_duplication_alert_contract_stays_metadata_only():
    """Privacy regression gate at the contract level (audit fix, 2026-07-28)."""
    document = json.loads(render_openapi())
    properties = document['components']['schemas']['DuplicationAlert']['properties']
    assert 'matched_abstract' not in properties
    assert 'matched_excerpt' not in properties
