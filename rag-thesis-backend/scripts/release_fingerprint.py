"""Generate deterministic PI-03 runtime, lock, model, and index provenance."""

import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path

from config import settings
from services.index_provenance import current_index_fingerprint

ROOT = Path(__file__).resolve().parents[2]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def git_commit() -> str | None:
    try:
        return subprocess.run(
            ['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True,
            capture_output=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def build_manifest() -> dict:
    inputs = [
        ROOT / 'rag-thesis-backend' / 'requirements.txt',
        ROOT / 'rag-thesis-frontend' / 'package-lock.json',
        ROOT / 'rag-thesis-backend' / 'Dockerfile',
        ROOT / 'rag-thesis-frontend' / 'Dockerfile',
        ROOT / 'docker-compose.operations.yml',
    ]
    return {
        'schema_version': 1,
        'git_commit': git_commit(),
        'runtime': {'python': platform.python_version(), 'python_implementation': platform.python_implementation()},
        'models': {
            'chat': settings.gemini_chat_model,
            'verdict': settings.gemini_verdict_model,
            'embedding': settings.gemini_embed_model,
        },
        'index_fingerprint': current_index_fingerprint(),
        'input_sha256': {
            str(path.relative_to(ROOT)).replace('\\', '/'): sha256_file(path) for path in inputs
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    arguments = parser.parse_args()
    payload = json.dumps(build_manifest(), indent=2, sort_keys=True) + '\n'
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(payload, encoding='utf-8')
    else:
        print(payload, end='')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
