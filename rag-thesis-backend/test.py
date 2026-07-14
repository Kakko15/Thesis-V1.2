import os
import json
from supabase import create_client
from dotenv import load_dotenv

load_dotenv('d:/Thesis/Thesis-V1.2/rag-thesis-backend/.env')
url = os.environ.get('SUPABASE_URL')
key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not key:
    print("NO KEY")
    exit(1)
sb = create_client(url, key)

res = sb.table('profiles').select('id, email, role, status, department').execute()
for p in res.data:
    if not isinstance(p.get('role'), str) or not isinstance(p.get('status'), str) or not isinstance(p.get('department'), str):
        print("FOUND NON-STRING IN PROFILE:", p)

res2 = sb.table('papers').select('id, department, track').execute()
for p in res2.data:
    if not isinstance(p.get('department'), str) or not isinstance(p.get('track'), str):
        print("FOUND NON-STRING IN PAPER:", p)

res3 = sb.table('departments').select('*').execute()
for d in res3.data:
    print("DEPT:", d)

print("DONE")
