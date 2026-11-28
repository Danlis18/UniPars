"""Конфігурація, профіль, університети, предмети, сповіщення, новини."""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from app.api.context import Ctx, ctx
from app.core.auth import university_header
from app.core.config import get_settings
from app.core.deps import get_storage, get_store
from app.schemas.content import JoinUniversity, ProfileUpdate, SubscriptionsSet
from app.services import news as news_service
from app.services import notifications
from app.services.avatars import MAX_AVATAR_BYTES, remove_avatar, set_avatar
from app.services.catalog import CatalogService

router = APIRouter()


@router.get("/config")
def config():
    s = get_settings()
    import os

    out = {"mode": s.app_mode, "ai_enabled": s.chat_enabled, "ai_model": s.ai_model if s.chat_enabled else None,
           "regeneration_enabled": s.ai_enabled or s.is_demo,
           "max_upload_mb": s.max_upload_mb,
           # для публічної оферти: ціни й реквізити продавця (лише публічні дані)
           "prices": {"single_kop": s.price_single_kop, "subscription_kop": s.price_subscription_kop,
                      "subscription_credits": s.subscription_credits, "topup_kop": s.price_topup_kop, "currency": "UAH"},
           "payment_provider": s.payment_provider,
           "vapid_public_key": s.vapid_public_key or None,  # публічний ключ Web Push (не секрет)
           "legal": {"name": s.legal_name, "tax_id": s.legal_tax_id, "address": s.legal_address, "iban": s.legal_iban,
                     "phone": s.legal_phone, "email": s.support_email, "ready": s.legal_ready}}
    if s.is_demo and os.environ.get("DEMO_SEED") == "showcase":
        out["demo_auth"] = "password"  # тестове середовище для відео: звичайна форма входу замість вибору профілю
    return out


class DemoLogin(BaseModel):
    email: str
    password: str


@router.post("/demo/login")
def demo_login(data: DemoLogin):
    """Лише демо-режим із DEMO_SEED=showcase: вхід тестовими адресами й паролем (не для продакшну)."""
    import os

    if not get_settings().is_demo or os.environ.get("DEMO_SEED") != "showcase":
        raise HTTPException(404, "Недоступно")
    from app.repositories.showcase_seed import DEMO_ACCOUNTS, DEMO_PASSWORD

    uid = DEMO_ACCOUNTS.get(data.email.strip().lower())
    if not uid or data.password != DEMO_PASSWORD:
        raise HTTPException(401, "Неправильний email або пароль")
    return {"user_id": uid}


@router.get("/covers")
def covers():
    """Бібліотека обкладинок профілю (публічна, кешується браузером)."""
    from app.core.covers import COVERS

    return [{"key": k, "name": n, "theme": t, "source": f"https://www.pexels.com/photo/{pid}/"} for k, (n, t, pid) in COVERS.items()]


@router.get("/demo/users")
def demo_users():
    if not get_settings().is_demo:
        raise HTTPException(404, "Недоступно")
    from app.repositories.demo_store import seed_module

    DEMO_USERS = seed_module().DEMO_USERS

    store = get_store()
    unis = {u["id"]: u["short_name"] for u in store.select("universities")}
    return [{"id": u["id"], "display_name": u["display_name"], "role": u["role"], "note": u["note"],
             "university": unis.get(u["uni"]), "university_id": u["uni"]} for u in DEMO_USERS]


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
def subjects(q: str | None = None, mine: bool = False, scope: str = Query("all", pattern="^(all|program|course)$"),
             c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return CatalogService(c.store, c.access).subjects(uni, q, mine, scope)


@router.post("/me/avatar")
async def upload_avatar(file: UploadFile = File(...), c: Ctx = Depends(ctx)):
    data = await file.read(MAX_AVATAR_BYTES + 1)
    return set_avatar(c.store, c.user.id, data, get_storage())


@router.delete("/me/avatar")
def delete_avatar(c: Ctx = Depends(ctx)):
    return remove_avatar(c.store, c.user.id, get_storage())


@router.get("/public/{path:path}")
def public_file(path: str):
    """Демо-режим: публічні файли (аватари). У Supabase вони віддаються напряму зі Storage."""
    f = getattr(get_storage(), "public_file", lambda p: None)(path)
    if not f:
        raise HTTPException(404, "Не знайдено")
    return FileResponse(f, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable"})


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


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict


class PushEndpoint(BaseModel):
    endpoint: str


@router.post("/push/subscriptions")
def push_subscribe(data: PushSubscription, request: Request, c: Ctx = Depends(ctx)):
    from app.services import push

    p256dh, auth = str(data.keys.get("p256dh", "")), str(data.keys.get("auth", ""))
    if not p256dh or not auth or len(data.endpoint) > 1000:
        raise HTTPException(400, "Неповна підписка браузера")
    return push.subscribe(c.store, c.user.id, data.endpoint, p256dh, auth, request.headers.get("user-agent"))


@router.post("/push/unsubscribe")
def push_unsubscribe(data: PushEndpoint, c: Ctx = Depends(ctx)):
    from app.services import push

    return push.unsubscribe(c.store, c.user.id, data.endpoint)


@router.post("/internal/subscription-reminders")
def subscription_reminders(x_cron_secret: str = Header(default="")):
    """Запуск за розкладом (.github/workflows/reminders.yml). Без правильного секрету — 404."""
    import hmac

    from app.services.reminders import subscription_reminders as run

    secret = get_settings().cron_secret
    if len(secret) < 16 or not hmac.compare_digest(x_cron_secret, secret):
        raise HTTPException(404, "Не знайдено")
    return run(get_store())


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
    found = resolve(token, sig) if resolve else None
    if not found:
        raise HTTPException(404, "Посилання недійсне або прострочене")
    path, download, name = found
    return FileResponse(path, filename=name, content_disposition_type="attachment" if download else "inline",
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})
