from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, ai, core, posts, social
from app.core.config import get_settings
from app.core.deps import get_store
from app.services.news import periodic_sync

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    task = asyncio.create_task(periodic_sync(get_store, s.news_sync_interval_seconds))
    logging.getLogger("unipars").info("UniPars API: mode=%s, ai=%s", s.app_mode, "on" if s.ai_enabled else "off")
    yield
    task.cancel()


app = FastAPI(title="UniPars API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (core.router, posts.router, social.router, ai.router, admin.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health(deep: bool = False):
    """deep=1 — перевірка з'єднання з базою та Supabase Auth (без розкриття секретів)."""
    if not deep:
        return {"ok": True}
    s = get_settings()
    out: dict = {"ok": True, "mode": s.app_mode, "ai_enabled": s.ai_enabled, "cors_origins": s.cors_origins}
    if s.is_demo:
        return out
    from urllib.parse import urlparse

    import httpx

    out["supabase_host"] = urlparse(s.supabase_url).hostname
    try:
        out["universities"] = get_store().count("universities")
        out["database"] = "ok"
    except Exception as e:  # неправильний URL/ключ або не застосовані міграції
        out["ok"] = False
        out["database"] = f"error: {type(e).__name__}: {str(e)[:200]}"
    try:
        r = httpx.get(f"{s.supabase_url}/auth/v1/.well-known/jwks.json", timeout=10,
                      headers={"apikey": s.supabase_service_role_key})
        out["auth_jwks"] = "ok" if r.status_code == 200 else f"HTTP {r.status_code}"
    except Exception as e:
        out["ok"] = False
        out["auth_jwks"] = f"error: {type(e).__name__}"
    return out


@app.get("/")
def root():
    """Щоб відкриття адреси backend у браузері не виглядало як помилка."""
    s = get_settings()
    return {"service": "UniPars API", "mode": s.app_mode, "health": "/api/health", "config": "/api/config"}
