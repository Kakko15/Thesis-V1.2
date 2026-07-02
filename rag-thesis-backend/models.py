from pydantic import BaseModel
from typing import Optional
 
class ChatRequest(BaseModel):
    question: str
    session_id: Optional[str] = None
    match_count: int = 5
    match_threshold: float = 0.3

class SessionCreate(BaseModel):
    title: str

class SessionUpdate(BaseModel):
    title: str
 
class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]
 
class PaperOut(BaseModel):
    id: str
    title: str
    authors: Optional[str]
    year: Optional[int]
    abstract: Optional[str]
    created_at: str

class ScanHistoryOut(BaseModel):
    id: str
    filename: str
    duplication_percentage: float
    top_matches: list[dict]
    verdict_summary: str
    created_at: str
