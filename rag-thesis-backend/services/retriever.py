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
        .select('id,title,authors,year,pdf_url') \
        .in_('id', paper_ids).execute()
    papers = papers_res.data or []
 
    # Group chunks by paper
    grouped_chunks = {}
    for c in chunks:
        grouped_chunks.setdefault(c['paper_id'], []).append(c['content'])
        
    context_parts = []
    sources = []
    
    for i, p in enumerate(papers):
        p_chunks = grouped_chunks.get(p['id'], [])
        combined_text = "\n...\n".join(p_chunks)
        
        authors_info = f", Authors: {p['authors']}" if p.get('authors') else ""
        year_info = f", Year: {p['year']}" if p.get('year') else ""
        
        context_parts.append(f"[{i+1}] {p.get('title', '?')}{authors_info}{year_info}\n{combined_text}")
        sources.append(p)
 
    context = '\n\n'.join(context_parts)
    return context, sources
