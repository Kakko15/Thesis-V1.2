from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# CCSICT academic tracks (thesis paper, Section 3.2.1)
CCSICT_TRACKS = [
    'Data Mining',
    'Web Development',
    'Network Security',
    'Intelligent Systems',
    'Information Management',
]


class ChatRequest(BaseModel):
    # Old clients may still send match_count/match_threshold. They are
    # intentionally ignored: retrieval policy is controlled by the server.
    model_config = ConfigDict(extra='ignore')

    question: str = Field(..., min_length=1, max_length=4000)
    session_id: Optional[str] = Field(None, max_length=64)
    department_filter: Optional[str] = Field(None, min_length=1, max_length=100)
    # Ephemeral guest context contains user questions only. It is never stored
    # or treated as thesis evidence, and authenticated clients cannot use it.
    guest_history: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    ] = Field(default_factory=list, max_length=5)
    # IDs are re-fetched and department-scoped by the backend before use.
    guest_source_ids: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    ] = Field(default_factory=list, max_length=5)


class DuplicationAlert(BaseModel):
    flagged: bool
    similarity: float
    threshold: float
    matched_paper: dict
    matched_abstract: str = ''
    matched_excerpt: str = ''
    matched_location: dict = Field(default_factory=dict)
    summary: str = ''


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict] = Field(default_factory=list)
    duplication_alert: Optional[DuplicationAlert] = None
    session_id: Optional[str] = None
    no_relevant_thesis: bool = False
    history_saved: bool = False


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
    highest_similarity: float = 0.0
    matched_chunk_percentage: float = 0.0
    matched_chunk_count: int = 0
    total_chunks: int = 0
    verdict_level: str = 'clear'
    department: Optional[str] = None
    top_matches: list[dict] = Field(default_factory=list)
    verdict_summary: Optional[str] = None
    created_at: str


class RoleUpdate(BaseModel):
    role: str = Field(..., pattern='^(student|faculty|admin|superadmin)$')
    status: Optional[str] = Field(None, pattern='^(pending|approved|rejected)$')

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, max_length=120)
    avatar_url: Optional[str] = Field(None, max_length=512)



class UserUpdate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=120)
    role: str = Field(..., pattern='^(student|faculty|admin|superadmin)$')
    department: Optional[str] = Field(None, min_length=1, max_length=100)
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
    tracks: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    ] = Field(default_factory=list, max_length=50)


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    track_label: Optional[str] = Field(None, min_length=1, max_length=50)
    tracks: Optional[list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    ]] = Field(None, max_length=50)
