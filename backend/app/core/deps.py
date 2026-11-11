"""Фабрики залежностей: store, storage, AI-провайдер."""
from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings


def get_store():
    s = get_settings()
    if s.is_demo:
        from app.repositories.demo_store import get_demo_store

        return get_demo_store()
    return _supabase_store()


@lru_cache
def _supabase_store():
    from app.repositories.supabase_store import SupabaseStore

    s = get_settings()
    if not (s.supabase_url and s.supabase_service_role_key):
        raise RuntimeError("APP_MODE=supabase, але SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не задані")
    return SupabaseStore(s.supabase_url, s.supabase_service_role_key)


@lru_cache
def get_storage():
    s = get_settings()
    if s.is_demo:
        from app.repositories.storage import LocalStorage

        return LocalStorage(s.demo_upload_dir, s.file_link_secret)
    from app.repositories.storage import SupabaseStorage

    return SupabaseStorage(_supabase_store().client, s.storage_bucket)
