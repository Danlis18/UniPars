from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, ai, core, posts
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

for r in (core.router, posts.router, ai.router, admin.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/")
def root():
    """Щоб відкриття адреси backend у браузері не виглядало як помилка."""
    s = get_settings()
    return {"service": "UniPars API", "mode": s.app_mode, "health": "/api/health", "config": "/api/config"}
