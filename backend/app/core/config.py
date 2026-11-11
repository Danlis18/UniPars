"""Конфігурація з змінних середовища. Секрети живуть лише тут, на сервері."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _load_dotenv() -> None:
    env = Path(__file__).resolve().parents[2] / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_mode: str = "demo"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    storage_bucket: str = "attachments"
    ai_provider: str = "anthropic"
    ai_model: str = "claude-opus-5-5"
    anthropic_api_key: str = ""
    ai_timeout_seconds: int = 120
    ai_rate_limit_per_minute: int = 10
    max_upload_mb: int = 25
    file_link_secret: str = "change-me"
    news_sync_interval_seconds: int = 600
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    demo_upload_dir: Path = Path(__file__).resolve().parents[2] / ".demo_uploads"

    @property
    def is_demo(self) -> bool:
        return self.app_mode == "demo"

    @property
    def ai_enabled(self) -> bool:
        if self.ai_provider == "anthropic":
            return bool(self.anthropic_api_key)
        return False


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()
    e = os.environ.get
    return Settings(
        app_mode=e("APP_MODE", "demo"),
        supabase_url=e("SUPABASE_URL", "").rstrip("/"),
        supabase_service_role_key=e("SUPABASE_SERVICE_ROLE_KEY", ""),
        supabase_jwt_secret=e("SUPABASE_JWT_SECRET", ""),
        storage_bucket=e("STORAGE_BUCKET", "attachments"),
        ai_provider=e("AI_PROVIDER", "anthropic"),
        ai_model=e("AI_MODEL", "claude-opus-5-5"),
        anthropic_api_key=e("ANTHROPIC_API_KEY", ""),
        ai_timeout_seconds=_int("AI_TIMEOUT_SECONDS", 120),
        ai_rate_limit_per_minute=_int("AI_RATE_LIMIT_PER_MINUTE", 10),
        max_upload_mb=_int("MAX_UPLOAD_MB", 25),
        file_link_secret=e("FILE_LINK_SECRET", "change-me"),
        news_sync_interval_seconds=_int("NEWS_SYNC_INTERVAL_SECONDS", 600),
        cors_origins=[o.strip() for o in e("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    )
