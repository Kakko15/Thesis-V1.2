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
}

for _name, _value in _ISOLATED_TEST_ENV.items():
    os.environ[_name] = _value
