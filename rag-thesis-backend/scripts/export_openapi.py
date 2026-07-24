"""Export a deterministic OpenAPI contract snapshot for release evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from main import app


def render_openapi() -> str:
    """Return stable, human-reviewable OpenAPI JSON."""
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + '\n'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()

    payload = render_openapi()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(payload, encoding='utf-8', newline='\n')
    digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()
    print(json.dumps({
        'openapi': app.openapi_version,
        'output': args.output.as_posix(),
        'sha256': digest,
    }, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
