from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import upload, chat, papers
 
app = FastAPI(title='ThesisRAG API', version='1.0.0')
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # Allow all origins during development
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)
 
app.include_router(upload.router)
app.include_router(chat.router)
app.include_router(papers.router)
 
@app.get('/health')
def health(): return {'status': 'ok'}
 
# Run: uvicorn main:app --reload --port 8000
