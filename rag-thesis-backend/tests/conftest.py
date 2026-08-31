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
}

for _name, _value in _ISOLATED_TEST_ENV.items():
    os.environ[_name] = _value
