"""Test bootstrap with an isolated, non-production environment.

Unit tests must never inherit service endpoints or hardening switches from a
developer's local ``.env`` file.  Live disposable-project tests opt in
explicitly through their own guarded variables.
"""

import os
import sys
from pathlib import Path

# Ensure the backend root is importable regardless of the pytest invocation dir
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from warning_filters import silence_known_third_party_warnings

silence_known_third_party_warnings()

_ISOLATED_TEST_ENV = {
    'GEMINI_API_KEY': 'test-key',
    # Provider ROUTING, not just credentials. Omitting these let a developer's
    # real configuration reach the suite: four live GEMINI_API_KEYS turned the
    # rotation assertions red locally while CI stayed green, and setting
    # LLM_BASE_URL put the gateway ahead of every monkeypatched `chat.llm`, so
    # twelve tests bypassed their fakes and made real network calls.
    'GEMINI_API_KEYS': '',
    'LLM_BASE_URL': '',
    'LLM_API_KEY': '',
    'SUPABASE_URL': 'https://test-project.supabase.co',
    'SUPABASE_KEY': 'test-service-role-key',
    'APP_ENVIRONMENT': 'test',
    'RATE_LIMIT_STORAGE_URI': 'memory://',
    'REQUIRE_PRIVILEGED_MFA': 'false',
    'MALWARE_SCAN_MODE': 'disabled',
    'OPERATIONS_MONITOR_ENABLED': 'false',
    'RETENTION_ENFORCEMENT_ENABLED': 'false',
    'LANGSMITH_TRACING': 'false',
    'LANGCHAIN_TRACING_V2': 'false',
    'TURNSTILE_SECRET_KEY': '',
    'REQUIRE_OCR_FOR_SCANNED_PAGES': 'true',
}

for _name, _value in _ISOLATED_TEST_ENV.items():
    os.environ[_name] = _value


def _warn_unless_pinned_interpreter() -> None:
    """Name the cause when the suite is run outside the pinned environment.

    The README requires a venv called ``.venv`` because that is where
    ``requirements.lock`` is installed. Running the suite from a system Python
    instead picks up whatever versions happen to be there, and the first symptom
    is not a test failure: ``pytest.ini`` names
    ``starlette.exceptions.StarletteDeprecationWarning`` as a filter category,
    pytest resolves filter categories by importing them while it PARSES the
    config, and a Starlette without that class aborts the whole run with

        AttributeError: module 'starlette.exceptions' has no attribute
        'StarletteDeprecationWarning'

    before a single test is collected. That reads like a library bug rather
    than "wrong interpreter", and it cost a full debugging detour on
    2026-09-12. Anyone reproducing this artifact would hit the same wall.

    A warning rather than a hard failure, deliberately. CI installs from
    ``requirements.lock`` into the job's own environment with no ``.venv`` at
    all (`.github/workflows/quality.yml`), and a developer may have a working
    equivalent under another name. The aim is to name the cause, not to add a
    second way for the suite to refuse to run.
    """
    if os.environ.get('CI'):
        return
    expected = Path(__file__).resolve().parents[1] / '.venv'
    try:
        if Path(sys.prefix).resolve() == expected.resolve():
            return
    except OSError:
        pass
    print(
        f'\nWARNING: pytest is running from {sys.prefix}, not {expected}.\n'
        '         The pinned dependencies live in .venv; results from another\n'
        '         interpreter are not comparable to the recorded evidence.\n'
        '         Activate it first:  .\\.venv\\Scripts\\Activate.ps1\n',
        file=sys.stderr,
    )


_warn_unless_pinned_interpreter()
