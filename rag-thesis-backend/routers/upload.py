import fitz  # PyMuPDF
import uuid
import mimetypes
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from dependencies.auth import require_admin, sb
from services.chunker import split_text
from services.embedder import embed_texts
 
router = APIRouter(prefix='/upload', tags=['upload'])
 
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
    department: str = Form(''),
    user = Depends(require_admin)
):
    file_bytes = await file.read()
    content = extract_text(file_bytes, file.filename)
    if not content.strip():
        raise HTTPException(400, 'Could not extract text from file')
 
    # Upload to Supabase Storage
    unique_filename = f"{uuid.uuid4()}_{file.filename}"
    content_type = mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    
    try:
        # supabase-py upload accepts bytes directly
        sb.storage.from_("pdfs").upload(unique_filename, file_bytes, file_options={"content-type": content_type})
        public_url = sb.storage.from_("pdfs").get_public_url(unique_filename)
    except Exception as e:
        print(f"Storage upload failed: {e}")
        public_url = None

    # Save paper metadata
    paper_data = {
        'title': title, 'authors': authors,
        'year': int(year) if year.isdigit() else None,
        'abstract': abstract, 'content': content,
        'department': department,
        'filename': file.filename,
        'pdf_url': public_url
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
