"""Боти UniPars: службові акаунти, які відзначають нові дописи «Корисно».

Прозорість: кожен бот має позначку is_bot і показується в інтерфейсі з міткою
«Бот»; боти не пишуть повідомлень, не підписуються, не потрапляють у пошук людей
і в «Кого читати». Лайки ставляться поступово (не більше одного за цикл на допис),
щоб нові автори швидше отримували перший відгук.

Налаштування: BOTS_COUNT (0 — вимкнути), BOTS_INTERVAL_SECONDS.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from app.repositories.store import Row, Store

log = logging.getLogger("unipars.bots")

BOT_PROFILES = [
    ("Бот Квант", "Відзначаю корисні матеріали з фізики та електроніки ⚛️"),
    ("Бот Біт", "Слідкую за свіжими дописами з програмування 💾"),
    ("Бот Тензор", "Люблю конспекти з математики та ML 🧮"),
    ("Бот Сигма", "Підтримую тих, хто ставить запитання ✋"),
    ("Бот Вектор", "Помічаю пояснення, які варто прочитати 🧭"),
    ("Бот Байт", "Збираю найкорисніше з лабораторних 🔬"),
    ("Бот Логос", "Ціную чіткі пояснення та гарні відповіді 📚"),
    ("Бот Піксель", "Відзначаю нові роботи однокурсників 🎨"),
    ("Бот Ом", "Фанат схемотехніки та вбудованих систем ⚡"),
    ("Бот Дельта", "Радію кожному новому матеріалу 📈"),
]
BIO_SUFFIX = " · Автоматичний акаунт UniPars"
WINDOW = timedelta(days=7)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def bot_ids(store: Store) -> list[str]:
    return [p["id"] for p in store.select("profiles", [("is_bot", "eq", True)], order="display_name")]


def ensure_bots(store: Store, count: int, auth_admin=None) -> list[str]:
    """Створює відсутніх ботів. У Supabase профіль прив'язаний до auth.users, тож
    бот створюється через Admin API (без пароля, яким хтось міг би скористатися)."""
    count = max(0, min(count, len(BOT_PROFILES)))
    existing = {p["display_name"]: p["id"] for p in store.select("profiles", [("is_bot", "eq", True)])}
    for i, (name, bio) in enumerate(BOT_PROFILES[:count]):
        if name in existing:
            continue
        if auth_admin is not None:
            res = auth_admin.create_user({
                "email": f"bot{i + 1}.{secrets.token_hex(3)}@bots.unipars.invalid",
                "password": secrets.token_urlsafe(48),  # ніде не зберігається — увійти як бот неможливо
                "email_confirm": True,
                "user_metadata": {"display_name": name, "is_bot": True},
            })
            uid = res.user.id
            # профіль створює тригер on_auth_user_created; доповнюємо його
            store.update("profiles", {"id": uid}, {"display_name": name, "bio": bio + BIO_SUFFIX, "is_bot": True})
        else:
            uid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"unipars-bot-{i}"))
            store.insert("profiles", {"id": uid, "display_name": name, "bio": bio + BIO_SUFFIX, "is_bot": True,
                                      "avatar_url": None, "locale": "uk", "theme": "system", "is_platform_admin": False})
        existing[name] = uid
        log.info("bot created: %s", name)
    return list(existing.values())


def _target(post: Row, bots: int, now: datetime) -> int:
    """Скільки ботів має відзначити допис: від 1 до 4 одразу, потім ще трохи з часом."""
    h = int(hashlib.sha1(post["id"].encode()).hexdigest(), 16)
    age_h = (now - datetime.fromisoformat(post["created_at"].replace("Z", "+00:00"))).total_seconds() / 3600
    return min(bots, 1 + h % 4 + int(min(age_h, 72) // 18))


def like_tick(store: Store, now: datetime | None = None) -> int:
    """Один цикл: кожен свіжий допис отримує щонайбільше один новий лайк від бота."""
    now = now or _now()
    bots = bot_ids(store)
    if not bots:
        return 0
    bot_set = set(bots)
    since = (now - WINDOW).isoformat()
    posts = store.select("posts", [("created_at", "gte", since), ("is_hidden", "eq", False)], order="created_at", desc=True, limit=300)
    added = 0
    for p in posts:
        if p["author_id"] in bot_set:
            continue
        liked = {r["user_id"] for r in store.select("reactions", [("target_type", "eq", "post"), ("target_id", "eq", p["id"]),
                                                                   ("user_id", "in", bots)])}
        if len(liked) >= _target(p, len(bots), now):
            continue
        # детермінований, але різний для кожного допису порядок ботів
        order = sorted(bots, key=lambda b: hashlib.sha1(f"{p['id']}:{b}".encode()).hexdigest())
        bot = next(b for b in order if b not in liked)
        store.insert("reactions", {"user_id": bot, "target_type": "post", "target_id": p["id"], "kind": "useful"})
        fresh = store.get("posts", id=p["id"]) or p
        store.update("posts", {"id": p["id"]}, {"useful_count": (fresh.get("useful_count") or 0) + 1})
        added += 1
    return added


async def bots_loop(get_store, settings) -> None:
    import asyncio

    if settings.bots_count <= 0:
        return
    ready = False
    while True:
        try:
            store = get_store()
            if not ready:
                admin = None if settings.is_demo else store.client.auth.admin
                await asyncio.to_thread(ensure_bots, store, settings.bots_count, admin)
                ready = True
            n = await asyncio.to_thread(like_tick, store)
            if n:
                log.info("bots: +%d лайків", n)
        except Exception:
            log.exception("bots: помилка циклу")
        await asyncio.sleep(settings.bots_interval_seconds)
