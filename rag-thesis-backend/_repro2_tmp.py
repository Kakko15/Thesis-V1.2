import uuid, httpx, jwt
from dotenv import dotenv_values
from dependencies.auth import sb

fe = dotenv_values(r'C:\Users\Kazuha\Desktop\Thesis-V1\rag-thesis-frontend\.env')
url, anon = fe['VITE_SUPABASE_URL'].rstrip('/'), fe['VITE_SUPABASE_ANON_KEY']
email = f'claude-repro-{uuid.uuid4().hex[:8]}@gmail.com'
uid = None
try:
    c = sb.auth.admin.create_user({'email': email, 'password': uuid.uuid4().hex + 'Aa1!', 'email_confirm': True})
    uid = (c.user if hasattr(c, 'user') else c).id
    sb.table('profiles').upsert({'id': uid, 'email': email, 'full_name': 'Claude Repro',
                                 'role': 'admin', 'department': 'CCSICT', 'status': 'approved'}).execute()
    link = sb.auth.admin.generate_link({'type': 'magiclink', 'email': email})
    props = link.properties if hasattr(link, 'properties') else link['properties']
    hashed = getattr(props, 'hashed_token', None) or props['hashed_token']
    v = httpx.post(f'{url}/auth/v1/verify', headers={'apikey': anon, 'Content-Type': 'application/json'},
                   json={'type': 'magiclink', 'token_hash': hashed}, follow_redirects=False, timeout=30)
    access = None
    if v.status_code in (302, 303):
        frag = v.headers.get('location', '').split('#', 1)[-1]
        access = dict(p.split('=', 1) for p in frag.split('&') if '=' in p).get('access_token')
    else:
        access = v.json().get('access_token')
    if not access:
        print('verify failed', v.status_code, v.text[:300], v.headers.get('location', '')[:200]); raise SystemExit
    print('aal claim =', jwt.decode(access, options={'verify_signature': False}).get('aal'))
    for path in ('/analytics/overview', '/analytics/activity?limit=20', '/analytics/users'):
        r = httpx.get(f'http://localhost:8000{path}', headers={'Authorization': f'Bearer {access}'}, timeout=60)
        print(f'{r.status_code}  {path}  ->  {r.text[:200]}')
finally:
    if uid:
        sb.table('profiles').delete().eq('id', uid).execute()
        sb.auth.admin.delete_user(uid)
        print('cleaned up', email)
