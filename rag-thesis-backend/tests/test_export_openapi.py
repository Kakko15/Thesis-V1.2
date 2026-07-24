import hashlib
import json

from scripts.export_openapi import render_openapi


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
