"""Summarize one or more JMeter CSV/JTL runs into thesis-ready JSON."""

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def percentile(values: list[float], percent: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percent / 100
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarize_rows(rows: list[dict]) -> dict:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row.get('label', 'unknown')].append(row)

    def metrics(samples: list[dict]) -> dict:
        elapsed = [float(sample.get('elapsed') or 0) for sample in samples]
        successful = [str(sample.get('success', '')).lower() == 'true' for sample in samples]
        runs: dict[str, list[dict]] = defaultdict(list)
        for sample in samples:
            runs[str(sample.get('_run', 'single'))].append(sample)
        duration_seconds = 0.0
        for run_samples in runs.values():
            timestamps = [int(sample.get('timeStamp') or 0) for sample in run_samples]
            end_times = [
                stamp + int(sample.get('elapsed') or 0)
                for stamp, sample in zip(timestamps, run_samples)
            ]
            duration_seconds += max((max(end_times) - min(timestamps)) / 1000, 0.001)
        return {
            'samples': len(samples),
            'average_ms': round(sum(elapsed) / len(elapsed), 2) if elapsed else 0,
            'median_ms': round(percentile(elapsed, 50), 2),
            'p95_ms': round(percentile(elapsed, 95), 2),
            'p99_ms': round(percentile(elapsed, 99), 2),
            'throughput_per_second': round(len(samples) / duration_seconds, 3) if duration_seconds else 0,
            'error_rate_percent': round(100 * (1 - sum(successful) / len(successful)), 3) if successful else 0,
            'response_codes': dict(sorted({
                code: sum(1 for sample in samples if sample.get('responseCode') == code)
                for code in {sample.get('responseCode', '') for sample in samples}
            }.items())),
            'max_concurrent_threads': max(
                (int(sample.get('allThreads') or 0) for sample in samples), default=0,
            ),
            'measured_run_count': len(runs),
        }

    return {
        'overall': metrics(rows),
        'endpoints': {label: metrics(samples) for label, samples in sorted(grouped.items())},
    }


def load_runs(paths: list[Path]) -> list[dict]:
    rows = []
    for run_number, path in enumerate(paths, start=1):
        with path.open(newline='', encoding='utf-8-sig') as handle:
            for row in csv.DictReader(handle):
                row['_run'] = str(run_number)
                rows.append(row)
    return rows


def require_response_codes(summary: dict, required_codes: list[str]) -> None:
    """Fail evidence generation when an expected response was never observed."""
    observed = summary.get('overall', {}).get('response_codes', {})
    missing = [code for code in required_codes if int(observed.get(code, 0)) < 1]
    if missing:
        raise ValueError(f"required response code(s) not observed: {', '.join(missing)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('runs', nargs='+', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--users', type=int, required=True)
    parser.add_argument('--loops', type=int, required=True)
    parser.add_argument('--ramp-seconds', type=int, required=True)
    parser.add_argument('--require-response-code', action='append', default=[])
    args = parser.parse_args()

    summary = summarize_rows(load_runs(args.runs))
    summary.update({
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'profile': args.profile,
        'iterations': len(args.runs),
        'configuration': {
            'users': args.users, 'loops': args.loops,
            'ramp_seconds': args.ramp_seconds,
        },
        'source_files': [str(path) for path in args.runs],
    })
    require_response_codes(summary, args.require_response_code)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
