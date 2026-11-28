from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, ai, billing, core, messages, posts, social, tasks
from app.core.config import get_settings
from app.core.deps import get_store
from app.services.bots import bots_loop
from app.services.news import periodic_sync

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    task = asyncio.create_task(periodic_sync(get_store, s.news_sync_interval_seconds))
    bots_task = asyncio.create_task(bots_loop(get_store, s))
    logging.getLogger("unipars").info("UniPars API: mode=%s, ai=%s", s.app_mode, "on" if s.ai_enabled else "off")
    yield
    task.cancel()
    bots_task.cancel()


app = FastAPI(title="UniPars API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def unhandled_errors(request: Request, call_next):
    """Непередбачена помилка → JSON 500 із CORS-заголовками (інакше браузер бачить «немає з'єднання»)."""
    try:
        return await call_next(request)
    except Exception:
        rid = uuid.uuid4().hex[:8]
        logging.getLogger("unipars").exception("unhandled error %s %s [%s]", request.method, request.url.path, rid)
        return JSONResponse({"detail": f"Внутрішня помилка сервера. Код: {rid}"}, status_code=500)


# CORS додається останнім — він зовнішній і додає заголовки навіть до відповідей про помилки
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (core.router, posts.router, tasks.router, billing.router, social.router, messages.router, ai.router, admin.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health(deep: bool = False):
    """deep=1 — перевірка з'єднання з базою та Supabase Auth (без розкриття секретів)."""
    if not deep:
        return {"ok": True}
    s = get_settings()
    out: dict = {"ok": True, "mode": s.app_mode, "ai_enabled": s.ai_enabled, "cors_origins": s.cors_origins,
                 "payment_provider": s.payment_provider, "legal_ready": s.legal_ready,
                 "jar_ready": s.jar_ready if s.payment_provider == "jar" else None,
                 "push_enabled": bool(s.vapid_public_key and s.vapid_private_key), "cron_secret_set": len(s.cron_secret) >= 16}
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
    # Перевірка схеми: чи застосовані міграції (лише кількість записів, без даних)
    schema = {}
    for table in ("faculties", "programs", "study_groups", "subjects", "topics", "news_sources",
                  "follows", "dm_conversations", "dm_messages", "tasks", "task_files", "submissions",
                  "payments", "subscriptions", "regenerations", "refunds", "jar_transfers", "push_subscriptions"):
        try:
            schema[table] = get_store().count(table)
        except Exception:
            schema[table] = "missing"
            out["ok"] = False
    # Колонки з пізніших міграцій
    for key, table, col in (("profiles.cover", "profiles", "cover"),
                            ("subject_programs.courses", "subject_programs", "courses"),
                            ("profiles.is_bot", "profiles", "is_bot"),
                            ("university_memberships.entry_year", "university_memberships", "entry_year"),
                            ("faculties.registration_open", "faculties", "registration_open"),
                            ("posts.task_id", "posts", "task_id"),
                            ("submissions.is_anonymous", "submissions", "is_anonymous"),
                            ("credit_ledger.pool", "credit_ledger", "pool"),
                            ("subscriptions.canceled_at", "subscriptions", "canceled_at"),
                            ("payments.provider_ref", "payments", "provider_ref"),
                            ("subscriptions.reminded_period_end", "subscriptions", "reminded_period_end")):
        try:
            get_store().count(table, [(col, "is_null", False)])
            schema[key] = "ok"
        except Exception:
            schema[key] = "missing"
            out["ok"] = False
    # Функції балансу з міграції 14 (баланс = сума журналу); нульовий користувач — без даних
    try:
        get_store().rpc("billing_balance", {"p_user": "00000000-0000-0000-0000-000000000000"})
        schema["billing_functions"] = "ok"
    except Exception:
        schema["billing_functions"] = "missing"
        out["ok"] = False
    try:
        schema["bots"] = get_store().count("profiles", [("is_bot", "eq", True)])
    except Exception:
        schema["bots"] = "missing"
    out["schema"] = schema
    # Сховище файлів: бакети існують і доступні сервісному ключу (без розкриття вмісту)
    storage = {}
    for bucket in (s.storage_bucket, "avatars"):
        try:
            r = httpx.get(f"{s.supabase_url}/storage/v1/bucket/{bucket}", timeout=10,
                          headers={"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {s.supabase_service_role_key}"})
            if r.status_code == 200:
                b = r.json()
                lim = b.get("file_size_limit")
                storage[bucket] = f"ok, limit={round(lim / 1048576, 1)}MB" if lim else "ok, no limit"
            else:
                storage[bucket] = f"HTTP {r.status_code}"
                out["ok"] = False
        except Exception as e:
            storage[bucket] = f"error: {type(e).__name__}"
            out["ok"] = False
    out["storage"] = storage
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
