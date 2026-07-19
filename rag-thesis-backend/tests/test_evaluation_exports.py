from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from evaluation.export_langsmith import safe_run_record
from evaluation import export_sonar


def test_langsmith_export_contains_metrics_but_no_payload():
    start = datetime.now(timezone.utc)
    run = SimpleNamespace(
        id='run-1', trace_id='trace-1', name='rag.retrieval',
        inputs={'content_hidden': True}, outputs={}, start_time=start,
        end_time=start + timedelta(milliseconds=125), total_tokens=10,
        prompt_tokens=7, completion_tokens=3, error=None,
    )
    record = safe_run_record(run)
    assert record['latency_ms'] == 125
    assert record['total_tokens'] == 10
    assert 'inputs' not in record and 'outputs' not in record


def test_langsmith_export_rejects_trace_content():
    run = SimpleNamespace(id='run-2', inputs={'question': 'sensitive'}, outputs={})
    with pytest.raises(ValueError, match='payload content'):
        safe_run_record(run)


def test_sonar_export_uses_component_hotspot_measure(monkeypatch):
    responses = {
        '/api/measures/component': {
            'component': {'measures': [
                {'metric': 'security_hotspots', 'value': '2'},
                {'metric': 'bugs', 'value': '0'},
            ]},
        },
        '/api/qualitygates/project_status': {'projectStatus': {'status': 'OK'}},
        export_sonar.ISSUES_API_PATH: {'total': 3},
    }
    requested_paths = []

    def fake_request(_base_url, path, _params, _token):
        requested_paths.append(path)
        if path == export_sonar.ISSUES_API_PATH and _params.get('types'):
            return {'total': 0, 'issues': []}
        if path == export_sonar.ISSUES_API_PATH and _params.get('inNewCodePeriod'):
            return {'total': 1, 'issues': [{
                'key': 'new-1', 'rule': 'python:S0000', 'type': 'CODE_SMELL',
                'severity': 'MINOR', 'component': 'project:file.py',
                'line': 4, 'message': 'Example issue',
            }]}
        return responses[path]

    monkeypatch.setattr(export_sonar, 'request_json', fake_request)
    evidence = export_sonar.build_evidence('http://localhost:9000', 'project', 'token')

    assert evidence['security_hotspots'] == 2
    assert evidence['unresolved_issues'] == 3
    assert evidence['bugs_and_vulnerabilities'] == []
    assert evidence['new_code_issues'][0]['key'] == 'new-1'
    assert '/api/hotspots/search' not in requested_paths
