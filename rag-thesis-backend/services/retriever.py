from supabase import create_client
from config import settings
from services.embedder import embed_text
 
sb = create_client(settings.supabase_url, settings.supabase_key)
 
def search_chunks(question: str, match_count=5, threshold=0.3):
    q_embedding = embed_text(question)
    result = sb.rpc('match_chunks', {
        'query_embedding': q_embedding,
        'match_count': match_count,
        'match_threshold': threshold
    }).execute()
    chunks = result.data or []
    if not chunks:
        return [], []
 
    # Fetch paper metadata for found chunks
    paper_ids = list(set(c['paper_id'] for c in chunks))
    papers_res = sb.table('papers') \
        .select('id,title,authors,year') \
        .in_('id', paper_ids).execute()
    paper_map = {p['id']: p for p in (papers_res.data or [])}
 
    context = '\n\n'.join(
        f"[{i+1}] {paper_map.get(c['paper_id'], {}).get('title','?')}\n{c['content']}"
        for i, c in enumerate(chunks)
    )
    sources = [paper_map.get(c['paper_id']) for c in chunks if c['paper_id'] in paper_map]
    return context, sources
