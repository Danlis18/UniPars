"""Web Push: сповіщення в браузері, навіть коли UniPars закритий.

Ключі VAPID — у змінних оточення (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY; згенерувати: scripts/gen_vapid_keys.py).
Без ключів push вимкнено, а сповіщення лишаються в UniPars (дзвіночок).
Підписку браузера зберігаємо в push_subscriptions; недійсні (404/410 від push-сервісу) видаляємо.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.repositories.store import Store

ALLOWED_PUSH_HOSTS = (  # push-сервіси браузерів; інші адреси не приймаємо (захист від SSRF)
    "fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com",
    "web.push.apple.com", "notify.windows.com", "push.services.mozilla.com",
)


def enabled() -> bool:
    st = get_settings()
    return bool(st.vapid_public_key and st.vapid_private_key)


def _host_ok(endpoint: str) -> bool:
    from urllib.parse import urlparse

    u = urlparse(endpoint)
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in ALLOWED_PUSH_HOSTS)


def subscribe(store: Store, user_id: str, endpoint: str, p256dh: str, auth: str, user_agent: str | None) -> dict:
    if not enabled():
        raise HTTPException(503, "Push-сповіщення ще не налаштовані")
    if not _host_ok(endpoint):
        raise HTTPException(400, "Невідомий push-сервіс браузера")
    existing = store.get("push_subscriptions", endpoint=endpoint)
    row = {"user_id": user_id, "endpoint": endpoint, "p256dh": p256dh, "auth": auth, "user_agent": (user_agent or "")[:300]}
    if existing:
        store.update("push_subscriptions", {"id": existing["id"]}, row)  # той самий браузер, інший акаунт або нові ключі
    else:
        store.insert("push_subscriptions", row)
    return {"ok": True}


def unsubscribe(store: Store, user_id: str, endpoint: str) -> dict:
    store.delete("push_subscriptions", {"endpoint": endpoint, "user_id": user_id})
    return {"ok": True}


def _send_one(sub: dict, payload: str) -> int:
    """Повертає HTTP-статус push-сервісу (201 — прийнято)."""
    from pywebpush import WebPushException, webpush

    st = get_settings()
    try:
        r = webpush(subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                    data=payload, vapid_private_key=st.vapid_private_key,
                    vapid_claims={"sub": f"mailto:{st.support_email or 'support@unipars.app'}"}, ttl=86400, timeout=10)
        return getattr(r, "status_code", 201)
    except WebPushException as e:
        return getattr(e.response, "status_code", 0) if e.response is not None else 0


def send(store: Store, user_id: str, title: str, body: str, url: str = "/") -> int:
    """Надіслати push на всі браузери користувача. Повертає, скільки прийнято. Недійсні підписки видаляються."""
    if not enabled():
        return 0
    payload = json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False)
    sent = 0
    for sub in store.select("push_subscriptions", [("user_id", "eq", user_id)]):
        status = _send_one(sub, payload)
        if status in (404, 410):  # браузер відписався або підписка застаріла
            store.delete("push_subscriptions", {"id": sub["id"]})
        elif 200 <= status < 300:
            sent += 1
            store.update("push_subscriptions", {"id": sub["id"]}, {"last_used_at": datetime.now(timezone.utc).isoformat()})
    return sent
