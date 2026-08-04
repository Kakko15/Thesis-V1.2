from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration loaded from the backend .env file."""

    # --- Required secrets ---
    gemini_api_key: str
    supabase_url: str
    supabase_key: str  # SERVICE_ROLE key (backend bypasses RLS)

    # --- Model configuration (current Gemini models; paper architecture unchanged) ---
    gemini_chat_model: str = 'gemini-3.6-flash'
    gemini_verdict_model: str = 'gemini-3.5-flash-lite'
    gemini_embed_model: str = 'models/gemini-embedding-2'
    # The current pgvector schema is vector(768). A dimension change requires
    # an explicit database migration rather than an environment-only switch.
    embedding_dimensions: Literal[768] = 768
    gemini_timeout_seconds: float = 25.0
    gemini_max_retries: int = 1
    gemini_max_output_tokens: int = 700
    gemini_thinking_level: Literal['minimal', 'low', 'medium', 'high'] = 'low'
    gemini_capacity_cooldown_seconds: int = 60

    # --- RAG parameters (thesis paper, Section 3.2.3) ---
    # Fixed thesis contract; measured by the documented local tokenizer proxy.
    chunk_size_tokens: Literal[800] = 800
    chunk_overlap_tokens: Literal[100] = 100
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
    # Unauthenticated read endpoints the landing page calls (public summary and
    # the academic catalog). They sat outside every named limit, so only the
    # global 120/minute default applied and a loop over them forced a
    # full-table read per request — a cheap denial-of-wallet vector.
    rate_limit_public: str = '30/minute'
    rate_limit_storage_uri: str = 'memory://'
    # Global ceiling on a day's total guest research spend, in tokens measured by
    # the documented tokenizer proxy. The per-guest and per-IP limits bound how
    # fast one caller can ask; nothing bounded the aggregate, so a distributed
    # script with valid Turnstile challenges could drain the shared Gemini quota
    # and take chat down for signed-in users too. 0 = unlimited, which keeps
    # development, the tests, and the frozen evaluation pipeline unchanged;
    # production must set a real number (see validate_production_services).
    guest_daily_token_budget: int = Field(default=0, ge=0)
    require_privileged_mfa: bool = False
    max_upload_mb: int = 25
    max_pdf_pages: int = Field(default=500, ge=1, le=2000)
    ingestion_poll_seconds: float = Field(default=2.0, ge=0.2, le=60.0)
    ingestion_lease_seconds: int = Field(default=120, ge=30, le=900)
    ingestion_heartbeat_seconds: int = Field(default=30, ge=5, le=300)
    ingestion_max_attempts: int = Field(default=3, ge=1, le=10)
    ingestion_maintenance_seconds: int = Field(default=300, ge=30, le=3600)
    operations_monitor_enabled: bool = False
    operations_monitor_seconds: int = Field(default=60, ge=15, le=3600)
    operations_worker_stale_seconds: int = Field(default=90, ge=30, le=900)
    operations_queue_age_seconds: int = Field(default=300, ge=60, le=86400)
    operations_queue_depth_threshold: int = Field(default=10, ge=1, le=10000)
    operations_cleanup_age_seconds: int = Field(default=600, ge=60, le=86400)
    # Declared disaster-recovery targets (§8.1). The RPO doubles as the staleness
    # threshold: when the newest recorded backup is older than this, the
    # operations monitor raises a `backup_stale` alert. 0 disables the check, so a
    # deployment whose backups are handled elsewhere is not permanently alerting.
    # Deliberately not enforced at startup — backups run on a separate machine,
    # and the API refusing to boot over them would be the wrong coupling.
    backup_rpo_hours: int = Field(default=0, ge=0, le=8760)
    # Recorded rather than enforced: the target a restore drill is measured
    # against. Nothing in the API can verify it; the drill log is the evidence.
    backup_rto_hours: int = Field(default=4, ge=1, le=8760)
    operations_alert_webhook_url: str = ''
    operations_alert_webhook_secret: str = ''
    operations_alert_timeout_seconds: float = Field(default=5.0, ge=1.0, le=30.0)
    retention_enforcement_enabled: bool = False
    malware_scan_mode: Literal['disabled', 'clamav'] = 'disabled'
    clamav_host: str = '127.0.0.1'
    clamav_port: int = Field(default=3310, ge=1, le=65535)
    clamav_timeout_seconds: float = Field(default=20.0, ge=1.0, le=120.0)
    # Optional: Cloudflare Turnstile guard for guest chat. When the secret is
    # set, unauthenticated /chat callers must present one verified Turnstile
    # token per guest session (the client-minted X-Guest-ID is otherwise free
    # to rotate past per-guest rate limits). Empty secret = guard off, so the
    # frozen thesis-evaluation pipeline and default behavior are unchanged.
    turnstile_secret_key: str = ''
    turnstile_verify_timeout_seconds: float = Field(default=5.0, ge=1.0, le=30.0)
    turnstile_guest_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    # Cloudflare echoes the widget's action and the solving page's hostname.
    # Checking both stops a token minted for another widget (for example the
    # sign-in challenge) or on another site from unlocking guest chat.
    turnstile_expected_action: str = 'guest_chat'
    # Comma-separated public hostnames. Empty disables the hostname check so
    # localhost development keeps working.
    turnstile_allowed_hostnames: str = ''

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

    # Class-based `Config` is deprecated in Pydantic V2 and removed in V3.0; it
    # emitted a PydanticDeprecatedSince20 warning on every import. Same
    # env_file and extra behaviour, declared the supported way. No RAG
    # parameter value changes — the frozen thesis contract above is untouched.
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(',') if o.strip()]

    @property
    def turnstile_allowed_hostname_list(self) -> list[str]:
        return [h.strip().lower() for h in self.turnstile_allowed_hostnames.split(',') if h.strip()]

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
        if self.ingestion_heartbeat_seconds * 2 >= self.ingestion_lease_seconds:
            raise ValueError('Ingestion heartbeat must be less than half the worker lease')
        if self.app_environment == 'production' and self.rate_limit_storage_uri.startswith('memory://'):
            raise ValueError('Production requires a shared Redis rate-limit storage URI')
        if self.app_environment == 'production' and not self.require_privileged_mfa:
            raise ValueError('Production requires MFA for privileged accounts')
        if self.app_environment == 'production' and self.malware_scan_mode != 'clamav':
            raise ValueError('Production requires ClamAV malware scanning')
        if self.app_environment == 'production' and self.guest_daily_token_budget <= 0:
            raise ValueError('Production requires a global daily guest token budget')
        webhook_values = bool(self.operations_alert_webhook_url), bool(
            self.operations_alert_webhook_secret
        )
        if webhook_values[0] != webhook_values[1]:
            raise ValueError('Operations webhook URL and signing secret must be configured together')
        if self.operations_alert_webhook_url and not self.operations_alert_webhook_url.startswith('https://'):
            raise ValueError('Operations alert webhook must use HTTPS')
        if self.operations_alert_webhook_secret and len(self.operations_alert_webhook_secret) < 32:
            raise ValueError('Operations webhook signing secret must be at least 32 characters')
        return self


settings = Settings()
