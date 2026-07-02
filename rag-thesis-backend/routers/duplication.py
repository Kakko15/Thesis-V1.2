import fitz
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from dependencies.auth import require_admin, sb
from services.chunker import split_text
from services.embedder import embed_texts
from config import settings
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel

router = APIRouter(prefix='/duplication', tags=['duplication'])

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=settings.gemini_api_key,
    temperature=0.2
)

class DuplicationChatReq(BaseModel):
    scan_id: str
    question: str

def extract_text(file_bytes: bytes, filename: str) -> str:
    if filename.lower().endswith('.pdf'):
        doc = fitz.open(stream=file_bytes, filetype='pdf')
        return '\n'.join(page.get_text() for page in doc)
    return file_bytes.decode('utf-8', errors='ignore')

@router.post('/scan')
async def scan_duplication(file: UploadFile = File(...), user = Depends(require_admin)):
    file_bytes = await file.read()
    content = extract_text(file_bytes, file.filename)
    if not content.strip():
        raise HTTPException(400, 'Could not extract text from file')

    # Chunk and embed
    chunks = split_text(content)
    embeddings = embed_texts(chunks)
    
    match_scores = []
    text_pairs = []
    
    # For each chunk, find nearest match in DB
    for i, emb in enumerate(embeddings):
        res = sb.rpc('match_chunks', {
            'query_embedding': emb,
            'match_count': 1,
            'match_threshold': 0.8  # Threshold for "duplication"
        }).execute()
        if res.data:
            best_match = res.data[0]
            match_scores.append(best_match)
            text_pairs.append({
                'paper_id': best_match['paper_id'],
                'uploaded_text': chunks[i],
                'database_text': best_match['content'],
                'similarity': best_match['similarity']
            })

    # Calculate duplicate percentage
    total_chunks = len(chunks)
    dup_chunks = len(match_scores)
    percentage = (dup_chunks / total_chunks) * 100 if total_chunks > 0 else 0

    # Aggregate top matches
    paper_matches = {}
    for match in match_scores:
        pid = match['paper_id']
        if pid not in paper_matches:
            paper_matches[pid] = {'count': 0, 'highest_similarity': 0}
        paper_matches[pid]['count'] += 1
        paper_matches[pid]['highest_similarity'] = max(paper_matches[pid]['highest_similarity'], match['similarity'])

    primary_pairs_saved = []

    if not paper_matches:
        verdict = "### Verdict: Acceptable\n\nNo significant duplication found. The paper appears highly original against the current database."
        top_papers_json = []
    else:
        # Sort by count desc
        top_pids = sorted(paper_matches.keys(), key=lambda x: paper_matches[x]['count'], reverse=True)[:3]
        
        # Fetch paper details
        papers_res = sb.table('papers').select('id,title,authors,year,pdf_url').in_('id', top_pids).execute()
        paper_lookup = {p['id']: p for p in (papers_res.data or [])}
        
        top_papers_json = []
        for pid in top_pids:
            p = paper_lookup.get(pid)
            if p:
                top_papers_json.append({
                    'id': p['id'],
                    'title': p['title'],
                    'authors': p.get('authors', ''),
                    'year': p.get('year', ''),
                    'pdf_url': p.get('pdf_url', ''),
                    'match_count': paper_matches[pid]['count'],
                    'similarity': round(paper_matches[pid]['highest_similarity'] * 100, 2)
                })
        
        # Focus AI on #1 match
        primary_match = top_papers_json[0]
        primary_pid = primary_match['id']
        
        primary_pairs = [p for p in text_pairs if p['paper_id'] == primary_pid]
        primary_pairs = sorted(primary_pairs, key=lambda x: x['similarity'], reverse=True)[:5]
        primary_pairs_saved = primary_pairs # Save for database
        
        pairs_str = ""
        for idx, p in enumerate(primary_pairs):
            pairs_str += f"\n--- EXCERPT {idx+1} (Similarity: {p['similarity']*100:.1f}%) ---\n"
            pairs_str += f"UPLOADED DRAFT TEXT:\n{p['uploaded_text']}\n\n"
            pairs_str += f"ORIGINAL DATABASE TEXT:\n{p['database_text']}\n"
        
        prompt = f"""
You are an expert academic reviewer analyzing a thesis paper for plagiarism and duplication.
The uploaded document was mathematically compared against the database.
Overall Duplication Percentage: {percentage:.1f}%

The MOST similar existing paper in the database is:
Title: {primary_match['title']}
Authors: {primary_match['authors']}
Number of duplicated paragraphs: {primary_match['match_count']}

Below are the exact excerpts where the uploaded draft copied the database paper:
{pairs_str}

Write a professional, concise Breakdown Summary of this duplication.
Explicitly point out exactly what chapters, concepts, or paragraphs were duplicated by actively comparing "Document A" (the uploaded draft) to "Document B" (the original database text).
Then, provide a Verdict (e.g., "Acceptable", "Requires Revision", "Rejected - High Duplication") and brief Suggestions.
Format your response using Markdown. Do not use [NO_SOURCES_USED].
"""
        response = llm.invoke(prompt)
        verdict = response.content if hasattr(response, 'content') else str(response)

    # Save to history
    history_data = {
        'user_id': user.id,
        'filename': file.filename,
        'duplication_percentage': percentage,
        'top_matches': top_papers_json,
        'verdict_summary': verdict,
        'matched_chunks': primary_pairs_saved,
        'chat_log': []
    }
    hist_res = sb.table('scan_history').insert(history_data).execute()

    return hist_res.data[0] if hist_res.data else history_data

@router.post('/chat')
def duplication_chat(req: DuplicationChatReq, user = Depends(require_admin)):
    scan_res = sb.table('scan_history').select('*').eq('id', req.scan_id).eq('user_id', user.id).execute()
    if not scan_res.data:
        raise HTTPException(404, "Scan not found")
        
    scan = scan_res.data[0]
    chat_log = scan.get('chat_log') or []
    
    history_str = ""
    for msg in chat_log[-5:]: # Keep context window manageable
        role = "Human" if msg.get('role') == 'user' else "AI"
        history_str += f"{role}: {msg.get('content')}\n\n"
        
    matched_chunks = scan.get('matched_chunks') or []
    pairs_str = ""
    for idx, p in enumerate(matched_chunks):
        pairs_str += f"\n--- EXCERPT {idx+1} ---\nUPLOADED DRAFT TEXT:\n{p.get('uploaded_text', '')}\n\nORIGINAL DATABASE TEXT:\n{p.get('database_text', '')}\n"

    prompt = f"""
You are an expert academic reviewer assisting a user with a plagiarism report.
Here is the Verdict and Summary you previously generated:
{scan.get('verdict_summary', '')}

Here are the exact duplicated text excerpts that were found:
{pairs_str}

Chat History:
{history_str}

Human: {req.question}
AI:
"""
    response = llm.invoke(prompt)
    answer = response.content if hasattr(response, 'content') else str(response)
    
    chat_log.append({'role': 'user', 'content': req.question})
    chat_log.append({'role': 'ai', 'content': answer})
    
    sb.table('scan_history').update({'chat_log': chat_log}).eq('id', req.scan_id).execute()
    
    return {'answer': answer, 'chat_log': chat_log}

@router.get('/history')
def get_history(user = Depends(require_admin)):
    res = sb.table('scan_history').select('*').eq('user_id', user.id).order('created_at', desc=True).execute()
    return res.data or []
