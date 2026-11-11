from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings

from .base import AIProvider


@lru_cache
def get_provider() -> AIProvider | None:
    """None, якщо AI не налаштовано — тоді UI показує «AI ще не підключено»."""
    s = get_settings()
    if not s.ai_enabled:
        return None
    if s.ai_provider == "anthropic":
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(s.anthropic_api_key, s.ai_model, s.ai_timeout_seconds)
    return None
