import fitz  # PyMuPDF
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Header
from supabase import create_client
from config import settings
from services.chunker import split_text
from services.embedder import embed_texts
 
router = APIRouter(prefix='/upload', tags=['upload'])
sb = create_client(settings.supabase_url, settings.supabase_key)
 
def extract_text(file_bytes: bytes, filename: str) -> str:
    if filename.lower().endswith('.pdf'):
        doc = fitz.open(stream=file_bytes, filetype='pdf')
        return '\n'.join(page.get_text() for page in doc)
    return file_bytes.decode('utf-8', errors='ignore')
 
@router.post('/paper')
async def upload_paper(
    file: UploadFile = File(...),
    title: str = Form(...),
    authors: str = Form(''),
    year: str = Form(''),
    abstract: str = Form(''),
    x_admin_secret: str = Header(default=''),
):
    if x_admin_secret != settings.admin_secret:
        raise HTTPException(403, 'Invalid admin secret')
 
    content = extract_text(await file.read(), file.filename)
    if not content.strip():
        raise HTTPException(400, 'Could not extract text from file')
 
    # Save paper metadata
    paper_data = {
        'title': title, 'authors': authors,
        'year': int(year) if year.isdigit() else None,
        'abstract': abstract, 'content': content,
        'filename': file.filename
    }
    paper_res = sb.table('papers').insert(paper_data).execute()
    paper = paper_res.data[0]
 
    # Chunk and embed
    chunks = split_text(content)
    embeddings = embed_texts(chunks)  # batch embed
 
    chunk_rows = [
        {'paper_id': paper['id'], 'chunk_index': i,
         'content': chunk, 'embedding': emb}
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings))
    ]
    sb.table('chunks').insert(chunk_rows).execute()
 
    return {'paper_id': paper['id'], 'title': title, 'chunks': len(chunks)}
