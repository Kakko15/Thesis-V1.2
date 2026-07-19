from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration loaded from the backend .env file."""

    # --- Required secrets ---
    gemini_api_key: str
    supabase_url: str
    supabase_key: str  # SERVICE_ROLE key (backend bypasses RLS)

    # --- Model configuration (current Gemini models; paper architecture unchanged) ---
    gemini_chat_model: str = 'gemini-3.1-flash-lite'
    gemini_verdict_model: str = 'gemini-3.1-flash-lite'
    gemini_embed_model: str = 'models/gemini-embedding-2'
    embedding_dimensions: int = 768
    gemini_timeout_seconds: float = 25.0
    gemini_max_retries: int = 1
    gemini_max_output_tokens: int = 700
    gemini_thinking_budget: int = 0
    gemini_capacity_cooldown_seconds: int = 60

    # --- RAG parameters (thesis paper, Section 3.2.3) ---
    # 800-token chunks with 100-token overlap (~4 chars per token calibration)
    chunk_size_tokens: int = 800
    chunk_overlap_tokens: int = 100
    retrieval_threshold: float = Field(default=0.30, ge=0.0, le=1.0)
    retrieval_match_count: int = Field(default=5, ge=1, le=20)
    duplication_threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    thesis_evaluation_department: str = Field(default='CCSICT', min_length=1)

    # --- Production hardening ---
    app_environment: Literal['development', 'test', 'production'] = 'development'
    cors_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    rate_limit_chat: str = '30/minute'
    rate_limit_chat_ip: str = '300/minute'
    rate_limit_upload: str = '10/minute'
    rate_limit_scan: str = '5/minute'
    rate_limit_followup: str = '20/minute'
    rate_limit_storage_uri: str = 'memory://'
    require_privileged_mfa: bool = False
    max_upload_mb: int = 25
    max_pdf_pages: int = Field(default=500, ge=1, le=2000)
    # Optional: Supabase legacy JWT secret (Project Settings -> API). When set,
    # rate limiting keys on the HS256-VERIFIED user id instead of the client
    # IP, so users behind one campus NAT get individual quotas. Signature
    # verification is required — otherwise forged tokens could mint fresh
    # rate-limit buckets. Falls back to IP when unset or verification fails.
    supabase_jwt_secret: str = ''

    # --- Optional LangSmith tracing (Performance Efficiency, ISO/IEC 25010) ---
    langchain_tracing_v2: bool = False
    langchain_api_key: str = ''
    langchain_project: str = ''
    langsmith_tracing: bool | None = None
    langsmith_api_key: str = ''
    langsmith_project: str = ''
    langsmith_hide_inputs: bool = True
    langsmith_hide_outputs: bool = True

    class Config:
        env_file = '.env'
        extra = 'ignore'

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(',') if o.strip()]

    @property
    def effective_langsmith_tracing(self) -> bool:
        if self.langsmith_tracing is not None:
            return self.langsmith_tracing
        return self.langchain_tracing_v2

    @property
    def effective_langsmith_api_key(self) -> str:
        return self.langsmith_api_key or self.langchain_api_key

    @property
    def effective_langsmith_project(self) -> str:
        return self.langsmith_project or self.langchain_project or 'isu-thesis-library'

    @model_validator(mode='after')
    def validate_production_services(self):
        if self.app_environment == 'production' and self.rate_limit_storage_uri.startswith('memory://'):
            raise ValueError('Production requires a shared Redis rate-limit storage URI')
        if self.app_environment == 'production' and not self.require_privileged_mfa:
            raise ValueError('Production requires MFA for privileged accounts')
        return self


settings = Settings()
