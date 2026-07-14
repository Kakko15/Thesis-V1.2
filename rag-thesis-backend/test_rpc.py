import asyncio
import os
from supabase import create_client

supabase_url = os.environ.get("SUPABASE_URL", "https://bpxkbeyyxocfvxsxbzgy.supabase.co")
supabase_key = os.environ.get("SUPABASE_KEY") # wait, need to import from config

from config import settings
sb = create_client(settings.supabase_url, settings.supabase_key)

res = sb.rpc('match_chunks', {
    'query_embedding': [0]*768,
    'match_count': 1,
    'match_threshold': 0.3,
    'p_department': 'CAS'
}).execute()
print(res.data)
