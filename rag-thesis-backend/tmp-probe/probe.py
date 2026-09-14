import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.update({
    'GEMINI_API_KEY': 'test-key','GEMINI_API_KEYS': '','LLM_BASE_URL': '','LLM_API_KEY': '',
    'SUPABASE_URL': 'https://test-project.supabase.co','SUPABASE_KEY': 'k',
    'APP_ENVIRONMENT': 'test','RATE_LIMIT_STORAGE_URI': 'memory://',
    'REQUIRE_PRIVILEGED_MFA': 'false','MALWARE_SCAN_MODE': 'disabled',
    'OPERATIONS_MONITOR_ENABLED': 'false','RETENTION_ENFORCEMENT_ENABLED': 'false',
    'LANGSMITH_TRACING': 'false','LANGCHAIN_TRACING_V2': 'false','TURNSTILE_SECRET_KEY': '',
})
from warning_filters import silence_known_third_party_warnings
silence_known_third_party_warnings()
from routers import chat as C
from services.guards import prohibited_reason

QS = [line for line in Path(sys.argv[1]).read_text(encoding='utf-8').splitlines() if line.strip()]
def flags(q):
    out = []
    if C._is_capability_question(q): out.append('CAP')
    if C._is_identity_question(q): out.append('IDENT')
    if C._is_simple_conversation(q): out.append('SIMPLE')
    if C._is_system_origin_question(q): out.append('ORIGIN')
    if C._is_ambiguous_system_origin_question(q): out.append('AMBORIGIN')
    if C._is_self_platform_reference(q): out.append('SELFPLAT')
    if C._is_model_question(q): out.append('MODEL')
    if C._is_courtesy_message(q): out.append('COURTESY')
    if C._is_archive_inventory_question(q): out.append('INVENTORY')
    r = prohibited_reason(q)
    if r: out.append('GUARD:'+r)
    return out or ['-> RETRIEVAL']
for q in QS:
    print(f'{",".join(flags(q)):28s} | {q}')
    print(f'{"":28s} | cands={C._short_query_candidates(q)}')
