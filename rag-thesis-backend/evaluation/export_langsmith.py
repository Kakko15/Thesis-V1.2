"""Export privacy-safe LangSmith timing evidence for Objective 4."""

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def safe_run_record(run) -> dict:
    inputs = getattr(run, 'inputs', None) or {}
    outputs = getattr(run, 'outputs', None) or {}
    if set(inputs) - {'content_hidden'} or outputs:
        raise ValueError(f'Run {getattr(run, "id", "unknown")} contains trace payload content')
    start = getattr(run, 'start_time', None)
    end = getattr(run, 'end_time', None)
    latency_ms = (end - start).total_seconds() * 1000 if start and end else None
    return {
        'run_id': str(getattr(run, 'id', '')),
        'trace_id': str(getattr(run, 'trace_id', '') or ''),
        'name': getattr(run, 'name', ''),
        'latency_ms': round(latency_ms, 2) if latency_ms is not None else None,
        'total_tokens': getattr(run, 'total_tokens', None),
        'prompt_tokens': getattr(run, 'prompt_tokens', None),
        'completion_tokens': getattr(run, 'completion_tokens', None),
        'status': 'error' if getattr(run, 'error', None) else 'completed',
        'error_category': type(getattr(run, 'error', None)).__name__ if getattr(run, 'error', None) else None,
    }


def main():
    from config import settings

    parser = argparse.ArgumentParser()
    parser.add_argument('--project', default=(
        os.getenv('LANGSMITH_PROJECT') or settings.effective_langsmith_project
    ))
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    api_key = os.getenv('LANGSMITH_API_KEY') or settings.effective_langsmith_api_key
    if not api_key:
        raise SystemExit('LANGSMITH_API_KEY is required')

    from langsmith import Client
    runs = list(Client(api_key=api_key).list_runs(project_name=args.project, limit=args.limit))
    records = [safe_run_record(run) for run in runs]
    evidence = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'project': args.project,
        'privacy': {'inputs_hidden': True, 'outputs_hidden': True},
        'run_count': len(records),
        'runs': records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
