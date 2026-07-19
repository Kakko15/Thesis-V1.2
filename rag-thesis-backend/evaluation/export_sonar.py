"""Export SonarQube quality evidence without storing credentials."""

import argparse
import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


METRICS = (
    'bugs,vulnerabilities,security_hotspots,code_smells,'
    'duplicated_lines_density,coverage,reliability_rating,security_rating,'
    'sqale_rating'
)
ISSUES_API_PATH = '/api/issues/search'


def request_json(base_url: str, path: str, params: dict, token: str) -> dict:
    url = f'{base_url.rstrip("/")}{path}?{urlencode(params)}'
    request = Request(url)
    request.add_header('Authorization', 'Basic ' + base64.b64encode(f'{token}:'.encode()).decode())
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def build_evidence(base_url: str, project: str, token: str) -> dict:
    measures = request_json(base_url, '/api/measures/component', {
        'component': project, 'metricKeys': METRICS,
    }, token)
    gate = request_json(base_url, '/api/qualitygates/project_status', {
        'projectKey': project,
    }, token)
    issues = request_json(base_url, ISSUES_API_PATH, {
        'componentKeys': project, 'resolved': 'false', 'ps': 1,
    }, token)
    risk_issues = request_json(base_url, ISSUES_API_PATH, {
        'componentKeys': project,
        'resolved': 'false',
        'types': 'BUG,VULNERABILITY',
        'ps': 100,
    }, token)
    new_issues = request_json(base_url, ISSUES_API_PATH, {
        'componentKeys': project,
        'resolved': 'false',
        'inNewCodePeriod': 'true',
        'ps': 100,
    }, token)
    component_measures = {
        item['metric']: item.get('value')
        for item in measures.get('component', {}).get('measures', [])
    }
    # Current Community Build versions restrict detailed hotspot search for
    # project-analysis tokens. Its aggregate component measure remains
    # available and is sufficient for reproducible quality evidence.
    hotspot_count = int(float(component_measures.get('security_hotspots', 0) or 0))
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'project': project,
        'quality_gate': gate.get('projectStatus', {}),
        'measures': component_measures,
        'unresolved_issues': issues.get('total', 0),
        'bugs_and_vulnerabilities': [
            {
                'key': issue.get('key'),
                'rule': issue.get('rule'),
                'type': issue.get('type'),
                'severity': issue.get('severity'),
                'component': issue.get('component'),
                'line': issue.get('line'),
                'message': issue.get('message'),
            }
            for issue in risk_issues.get('issues', [])
        ],
        'new_code_issues': [
            {
                'key': issue.get('key'),
                'rule': issue.get('rule'),
                'type': issue.get('type'),
                'severity': issue.get('severity'),
                'component': issue.get('component'),
                'line': issue.get('line'),
                'message': issue.get('message'),
            }
            for issue in new_issues.get('issues', [])
        ],
        'security_hotspots': hotspot_count,
        'security_hotspots_source': 'component_measure',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default=os.getenv('SONAR_HOST_URL', 'http://localhost:9000'))
    parser.add_argument('--project', default='isu-thesis-ai-library')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    token = os.getenv('SONAR_TOKEN', '')
    if not token:
        raise SystemExit('SONAR_TOKEN is required')
    evidence = build_evidence(args.url, args.project, token)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
