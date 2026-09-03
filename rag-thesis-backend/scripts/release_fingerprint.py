"""Generate deterministic PI-03 runtime, lock, model, and index provenance."""

import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from config import settings
from services.gemini_pool import gateway_enabled
from services.index_provenance import current_index_fingerprint
from services.prompts import PROMPT_VERSION

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


def gateway_host() -> str | None:
    """Host of the configured chat gateway, or None when Google is used directly.

    The host, never the URL and never the credential. A base URL can carry a
    path, a query string, or embedded userinfo, and this value is written into
    an artifact that is committed and shown to a panel.
    """
    base_url = settings.llm_base_url.strip()
    if not base_url:
        return None
    return urlsplit(base_url).hostname


def build_manifest() -> dict:
    inputs = [
        ROOT / 'rag-thesis-backend' / 'requirements.txt',
        # The lock is what actually gets installed, transitive dependencies
        # included, so the fingerprint would otherwise miss a transitive change.
        ROOT / 'rag-thesis-backend' / 'requirements.lock',
        ROOT / 'rag-thesis-backend' / 'config.py',
        ROOT / 'rag-thesis-backend' / 'routers' / 'chat.py',
        # The generation prompts moved out of chat.py into their own module.
        # Hashing only chat.py would have silently stopped covering them at
        # exactly the point where the paper claims the configuration is frozen.
        ROOT / 'rag-thesis-backend' / 'services' / 'prompts.py',
        # Retrieval selection (candidate pool, rerank, diversity cap) and the
        # question-type classifier decide what evidence reaches the prompt and
        # which task block frames it. Unhashed, a change to either would be
        # invisible to the manifest the paper's reproducibility claim rests on.
        ROOT / 'rag-thesis-backend' / 'services' / 'retriever.py',
        ROOT / 'rag-thesis-backend' / 'services' / 'question_types.py',
        ROOT / 'rag-thesis-frontend' / 'package-lock.json',
        ROOT / 'rag-thesis-backend' / 'Dockerfile',
        ROOT / 'rag-thesis-frontend' / 'Dockerfile',
        ROOT / 'docker-compose.operations.yml',
    ]
    return {
        # 4 adds the retrieval selection stage (candidate pool, hybrid rerank,
        # per-paper cap) to `rag_contract`, and hashes services/retriever.py
        # and services/question_types.py: selection now decides which chunks
        # reach the prompt, so two runs differing only in it are not the same
        # retrieval configuration and must not fingerprint alike.
        #
        # 3 adds the gateway's own reasoning and output bounds to
        # `generation_route`. They decide whether a reply on that route is
        # complete or severed, so two runs differing only in them are not the
        # same configuration and must not fingerprint alike.
        #
        # 2 adds `generation_route`. Section 3.2.1 of the paper claims every
        # reported result is attributable to one exact configuration, and until
        # this field existed that was not true: LLM_BASE_URL is read from the
        # environment with an empty default, so routing every chat, extract and
        # verdict call through a third-party gateway left this manifest
        # byte-identical to a direct-to-Google run.
        'schema_version': 4,
        'git_commit': git_commit(),
        'runtime': {'python': platform.python_version(), 'python_implementation': platform.python_implementation()},
        'models': {
            'chat': settings.gemini_chat_model,
            'verdict': settings.gemini_verdict_model,
            'embedding': settings.gemini_embed_model,
        },
        # Named rather than left to the file hash, so a reader can tell which
        # prompt contract produced a result without diffing two manifests.
        'prompt_version': PROMPT_VERSION,
        'generation_contract': {
            'timeout_seconds': settings.gemini_timeout_seconds,
            'max_retries': settings.gemini_max_retries,
            'max_output_tokens': settings.gemini_max_output_tokens,
            'thinking_level': settings.gemini_thinking_level,
        },
        # Which provider actually served the generation calls. The embedding
        # route is deliberately absent: it cannot be redirected (see
        # services/gemini_pool.py), so it is always Google and recording it
        # would imply a choice that does not exist.
        'generation_route': {
            'gateway_enabled': gateway_enabled(),
            'gateway_host': gateway_host(),
            # Null on the direct route rather than a number, because neither
            # applies there: `generation_contract` above is the whole story for
            # Google, and printing this route's budget beside it would read as
            # though it had been in force.
            'gateway_max_output_tokens': (
                settings.llm_gateway_max_output_tokens if gateway_enabled() else None
            ),
            'gateway_reasoning_effort': (
                settings.gemini_thinking_level if gateway_enabled() else None
            ),
            'reserve_key_count': len(settings.gemini_reserve_key_list),
        },
        'rag_contract': {
            'chunk_size_tokens': settings.chunk_size_tokens,
            'chunk_overlap_tokens': settings.chunk_overlap_tokens,
            'retrieval_threshold': settings.retrieval_threshold,
            'retrieval_match_count': settings.retrieval_match_count,
            'retrieval_candidate_pool': settings.retrieval_candidate_pool,
            'retrieval_per_paper_cap': settings.retrieval_per_paper_cap,
            'duplication_threshold': settings.duplication_threshold,
            'evaluation_department': settings.thesis_evaluation_department,
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
