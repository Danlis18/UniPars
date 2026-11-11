"""Конфігурація, профіль, університети, предмети, сповіщення, новини."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.context import Ctx, ctx
from app.core.auth import university_header
from app.core.config import get_settings
from app.core.deps import get_storage, get_store
from app.schemas.content import JoinUniversity, ProfileUpdate, SubscriptionsSet
from app.services import news as news_service
from app.services import notifications
from app.services.catalog import CatalogService

router = APIRouter()


@router.get("/config")
def config():
    s = get_settings()
    return {"mode": s.app_mode, "ai_enabled": s.ai_enabled, "ai_model": s.ai_model if s.ai_enabled else None,
            "max_upload_mb": s.max_upload_mb}


@router.get("/demo/users")
def demo_users():
    if not get_settings().is_demo:
        raise HTTPException(404, "Недоступно")
    from app.repositories.demo_seed import DEMO_USERS

    store = get_store()
    unis = {u["id"]: u["short_name"] for u in store.select("universities")}
    return [{"id": u["id"], "display_name": u["display_name"], "role": u["role"], "note": u["note"],
             "university": unis.get(u["uni"])} for u in DEMO_USERS]


@router.get("/me")
def me(c: Ctx = Depends(ctx)):
    return CatalogService(c.store, c.access).me()


@router.patch("/me")
def update_me(data: ProfileUpdate, c: Ctx = Depends(ctx)):
    return CatalogService(c.store, c.access).update_me(data)


@router.get("/universities")
def universities(c: Ctx = Depends(ctx)):
    return CatalogService(c.store, c.access).universities()


@router.get("/universities/{university_id}/structure")
def structure(university_id: str, c: Ctx = Depends(ctx)):
    return CatalogService(c.store, c.access).structure(university_id)


@router.post("/universities/{university_id}/join")
def join(university_id: str, data: JoinUniversity, c: Ctx = Depends(ctx)):
    return CatalogService(c.store, c.access).join(university_id, data)


@router.get("/subjects")
def subjects(q: str | None = None, mine: bool = False, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return CatalogService(c.store, c.access).subjects(uni, q, mine)


@router.get("/subjects/{key}")
def subject(key: str, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return CatalogService(c.store, c.access).subject(uni, key)


@router.post("/subjects/{subject_id}/subscribe")
def subscribe(subject_id: str, c: Ctx = Depends(ctx)):
    return CatalogService(c.store, c.access).toggle_subscription(subject_id)


@router.put("/me/subscriptions")
def set_subscriptions(data: SubscriptionsSet, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return CatalogService(c.store, c.access).set_subscriptions(uni, data.subject_ids)


@router.get("/notifications")
def list_notifications(c: Ctx = Depends(ctx)):
    return notifications.list_for(c.store, c.user.id)


@router.post("/notifications/read")
def read_notifications(c: Ctx = Depends(ctx)):
    notifications.mark_all_read(c.store, c.user.id)
    return {"ok": True}


@router.get("/news")
async def news(limit: int = Query(8, ge=1, le=30), c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    c.access.require_member(uni)
    return await news_service.news_for(c.store, uni, limit)


@router.get("/files/{token}")
def demo_file(token: str, sig: str):
    """Демо-режим: видача файлу за тимчасовим підписаним посиланням."""
    storage = get_storage()
    resolve = getattr(storage, "resolve_token", None)
    path = resolve(token, sig) if resolve else None
    if not path:
        raise HTTPException(404, "Посилання недійсне або прострочене")
    name = path.name.split("-", 1)[-1]
    return FileResponse(path, filename=name, content_disposition_type="inline")
