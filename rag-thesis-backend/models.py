from typing import Optional

from pydantic import BaseModel, Field

# CCSICT academic tracks (thesis paper, Section 3.2.1)
CCSICT_TRACKS = [
    'Data Mining',
    'Web Development',
    'Network Security',
    'Intelligent Systems',
    'Information Management',
]


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    session_id: Optional[str] = None
    department_filter: Optional[str] = None
    match_count: int = Field(default=5, ge=1, le=20)
    match_threshold: float = Field(default=0.3, ge=0.0, le=1.0)


class DuplicationAlert(BaseModel):
    flagged: bool
    similarity: float
    threshold: float
    matched_paper: dict
    matched_abstract: str = ''
    matched_excerpt: str = ''
    summary: str = ''


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict] = []
    duplication_alert: Optional[DuplicationAlert] = None
    session_id: Optional[str] = None
    no_relevant_thesis: bool = False


class MetadataExtractionResponse(BaseModel):
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    department: Optional[str] = None


class SessionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


class SessionUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


class PaperOut(BaseModel):
    id: str
    title: str
    authors: Optional[str] = None
    year: Optional[int] = None
    abstract: Optional[str] = None
    track: Optional[str] = None
    chunk_count: Optional[int] = 0
    duplication_scan: Optional[dict] = None  # ingest-time 85% screening result (metadata only)
    created_at: str
    uploader_name: Optional[str] = None
    department: Optional[str] = None


class UploadAccepted(BaseModel):
    job_id: str
    status: str
    message: str


class UploadJobStatus(BaseModel):
    job_id: str
    status: str            # queued | processing | completed | failed
    stage: str             # extract | store | chunk | embed | screen | index | done
    progress: int          # 0-100
    message: str = ''
    paper_id: Optional[str] = None
    chunks: Optional[int] = None
    duplication: Optional[dict] = None  # automatic 85% screening result (paper, Section 3.2.3 Phase 3)
    error: Optional[str] = None


class ScanHistoryOut(BaseModel):
    id: str
    filename: str
    duplication_percentage: float
    top_matches: list[dict] = []
    verdict_summary: Optional[str] = None
    created_at: str


class RoleUpdate(BaseModel):
    role: str = Field(..., pattern='^(student|faculty|admin|superadmin)$')
    status: Optional[str] = Field(None, pattern='^(pending|approved|rejected)$')

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None



class UserUpdate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=120)
    role: str = Field(..., pattern='^(student|faculty|admin|superadmin)$')
    department: Optional[str] = None
    status: Optional[str] = Field(None, pattern='^(pending|approved|rejected)$')


class DepartmentOut(BaseModel):
    id: str
    name: str
    track_label: str
    tracks: list[str]
    created_at: str


class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    track_label: str = Field(default="Academic track", min_length=1, max_length=50)
    tracks: list[str] = []


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    track_label: Optional[str] = Field(None, min_length=1, max_length=50)
    tracks: Optional[list[str]] = None
