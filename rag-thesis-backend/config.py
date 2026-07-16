from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration loaded from the backend .env file."""

    # --- Required secrets ---
    gemini_api_key: str
    supabase_url: str
    supabase_key: str  # SERVICE_ROLE key (backend bypasses RLS)

    # --- Model configuration (current Gemini models; paper architecture unchanged) ---
    gemini_chat_model: str = 'gemini-2.5-flash'
    gemini_verdict_model: str = 'gemini-2.5-flash'
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
    retrieval_threshold: float = 0.30      # below this: "no relevant thesis found"
    retrieval_match_count: int = 5
    duplication_threshold: float = 0.85    # paper-mandated 85% cosine similarity

    # --- Production hardening ---
    cors_origins: str = 'http://localhost:5173,http://127.0.0.1:5173'
    rate_limit_chat: str = '30/minute'
    rate_limit_upload: str = '10/minute'
    max_upload_mb: int = 25
    # Optional: Supabase legacy JWT secret (Project Settings -> API). When set,
    # rate limiting keys on the HS256-VERIFIED user id instead of the client
    # IP, so users behind one campus NAT get individual quotas. Signature
    # verification is required — otherwise forged tokens could mint fresh
    # rate-limit buckets. Falls back to IP when unset or verification fails.
    supabase_jwt_secret: str = ''

    # --- Optional LangSmith tracing (Performance Efficiency, ISO/IEC 25010) ---
    langchain_tracing_v2: str = ''
    langchain_api_key: str = ''
    langchain_project: str = 'isu-thesis-library'

    class Config:
        env_file = '.env'
        extra = 'ignore'

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(',') if o.strip()]


settings = Settings()
