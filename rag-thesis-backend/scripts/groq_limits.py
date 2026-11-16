"""Print Groq's live rate-limit headers for the configured model. No secrets printed."""
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import settings  # noqa: E402

response = httpx.post(
    f'{settings.groq_base_url}/chat/completions',
    headers={'Authorization': f'Bearer {settings.groq_api_key}'},
    json={'model': settings.groq_model, 'max_tokens': 20,
          'messages': [{'role': 'user', 'content': 'Say OK'}]},
    timeout=30,
)
print('status', response.status_code, 'model', settings.groq_model)
for name, value in response.headers.items():
    if 'ratelimit' in name.lower() or name.lower() == 'retry-after':
        print(f'{name}: {value}')
