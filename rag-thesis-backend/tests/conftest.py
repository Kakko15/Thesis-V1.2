"""Test bootstrap: dummy environment so modules import without real secrets."""

import os
import sys
from pathlib import Path

# Ensure the backend root is importable regardless of the pytest invocation dir
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault('GEMINI_API_KEY', 'test-key')
os.environ.setdefault('SUPABASE_URL', 'https://test-project.supabase.co')
os.environ.setdefault('SUPABASE_KEY', 'test-service-role-key')
os.environ.setdefault('APP_ENVIRONMENT', 'test')
