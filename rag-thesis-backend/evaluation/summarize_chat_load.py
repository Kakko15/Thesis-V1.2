"""Classify a `/chat` load run into answers, capacity notices, and failures.

`summarize_jmeter.py` reports status codes and latency percentiles, which is the
right thing for an endpoint whose 200 always means success. `/chat` is not that
endpoint: when the provider returns 429, the API deliberately answers **HTTP 200**
carrying an explicit capacity notice, and it holds a short cooldown during which
every further request gets that notice immediately. A JTL full of 200s can
therefore describe a system that answered almost nothing, and a median computed
across the mixture is meaningless — it lands in the gap between a 2 ms notice and
an 8 s answer.

This tool separates the bands so a reported percentile means one thing.

Classification, measured rather than assumed
--------------------------------------------
A companion run with `jmeter.save.saveservice.response_data=true` captured the
bodies of sub-second 200s and confirmed all of them contained the capacity
notice, at 1-18 ms. Genuine answers in the same session took 5.1-26.2 s. There is
a wide empty gap between the two, so:

    rc != 200                       -> failure (provider timeout, or 5xx)
    rc == 200, elapsed < 100 ms     -> capacity notice (confirmed by body capture)
    rc == 200, 100 ms <= e < 2000 ms-> ambiguous: too slow for the cooldown path,
                                       too fast for generation. Most likely an
                                       embedding that succeeded followed by an
                                       immediate provider 429. Reported
                                       separately rather than folded either way.
    rc == 200, elapsed >= 2000 ms   -> answer

Percentiles are reported over the answer band only, with n stated, so a small
sample cannot masquerade as a robust figure.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path

CAPACITY_MAX_MS = 100
ANSWER_MIN_MS = 2000


def percentile(values: list[int], percent: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percent / 100
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    weight = position - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight, 2)


def classify(path: Path) -> dict:
    with path.open(encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle))
    bands: dict[str, list[int]] = {
        'answer': [], 'capacity_notice': [], 'ambiguous_fast': [], 'failure': [],
    }
    codes: dict[str, int] = {}
    for row in rows:
        code = row.get('responseCode', '')
        elapsed = int(row.get('elapsed') or 0)
        codes[code] = codes.get(code, 0) + 1
        if code != '200':
            bands['failure'].append(elapsed)
        elif elapsed < CAPACITY_MAX_MS:
            bands['capacity_notice'].append(elapsed)
        elif elapsed < ANSWER_MIN_MS:
            bands['ambiguous_fast'].append(elapsed)
        else:
            bands['answer'].append(elapsed)

    answers = bands['answer']
    total = len(rows)
    return {
        'samples': total,
        'response_codes': codes,
        'bands': {name: len(values) for name, values in bands.items()},
        'band_share_percent': {
            name: (round(len(values) / total * 100, 1) if total else 0.0)
            for name, values in bands.items()
        },
        'answered_share_percent': round(len(answers) / total * 100, 1) if total else 0.0,
        'answer_latency_ms': {
            'n': len(answers),
            'min': min(answers) if answers else None,
            'median': percentile(answers, 50) if answers else None,
            'p95': percentile(answers, 95) if answers else None,
            'max': max(answers) if answers else None,
        },
        'capacity_notice_latency_ms': {
            'n': len(bands['capacity_notice']),
            'max': max(bands['capacity_notice']) if bands['capacity_notice'] else None,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('runs', nargs='+', type=Path,
                        help='JTL CSV files, one per concurrency profile.')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--corpus', required=True,
                        help='Corpus the run used, e.g. "synthetic-12-thesis".')
    parser.add_argument('--provider-tier', required=True,
                        help='Provider tier, e.g. "gemini-free".')
    args = parser.parse_args()

    profiles = {}
    for path in args.runs:
        if not path.is_file():
            print(f'missing run file: {path}')
            return 1
        # chat-5.jtl -> "5 users"
        label = path.stem.replace('chat-', '')
        profiles[f'{label}_users'] = classify(path)

    report = {
        'schema_version': 1,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'corpus': args.corpus,
        'provider_tier': args.provider_tier,
        'classification': {
            'capacity_notice_below_ms': CAPACITY_MAX_MS,
            'answer_at_or_above_ms': ANSWER_MIN_MS,
            'basis': (
                'A companion run captured response bodies and confirmed every '
                'sub-second HTTP 200 carried the capacity notice. Genuine answers '
                'in the same session took 5.1-26.2 s.'
            ),
        },
        'caveat': (
            'Measured on a synthetic corpus against the free provider tier. The '
            'answered share reflects provider rate limits, not application '
            'capacity; application-only throughput is measured separately by '
            'jmeter/provider_independent_load.jmx. Not a substitute for a run '
            'against the approved corpus on a paid tier.'
        ),
        'profiles': profiles,
        'source_files': [str(path) for path in args.runs],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    print(f'wrote {args.output}')
    print(f"{'profile':<14}{'samples':>8}{'answered':>10}{'notice':>8}{'ambig':>7}"
          f"{'fail':>6}{'median':>9}{'p95':>9}")
    for name, data in profiles.items():
        latency = data['answer_latency_ms']
        print(f"{name:<14}{data['samples']:>8}{data['bands']['answer']:>10}"
              f"{data['bands']['capacity_notice']:>8}{data['bands']['ambiguous_fast']:>7}"
              f"{data['bands']['failure']:>6}"
              f"{(latency['median'] or 0):>9.0f}{(latency['p95'] or 0):>9.0f}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
