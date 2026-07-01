from pydantic import BaseModel
from typing import Optional
 
class ChatRequest(BaseModel):
    question: str
    match_count: int = 5
    match_threshold: float = 0.3
 
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
