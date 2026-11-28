"""Новини університету: синхронізація, кеш, дедуплікація, стан джерел."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.integrations.news import adapters
from app.repositories.store import Row, Store

log = logging.getLogger("unipars.news")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_stale(source: Row) -> bool:
    if source["kind"] == "manual" or not source.get("is_enabled", True):
        return False
    last = source.get("last_synced_at")
    if not last:
        return True
    return _now() - datetime.fromisoformat(last) > timedelta(minutes=source.get("refresh_minutes", 30))


# Запити до бази синхронні (PostgREST через httpx) — в асинхронному коді виконуємо їх у пулі потоків,
# інакше кожен запит до Supabase зупиняв би обробку всіх інших користувачів.
_db = asyncio.to_thread
# Оновлення джерела, що вже йде: інші запити чекають його, а не запускають таке саме (100 студентів → 1 запит)
_inflight: dict[str, asyncio.Task] = {}


async def _sync_source(store: Store, source: Row) -> Row:
    try:
        items = await adapters.fetch(source)
    except Exception as e:  # мережа, парсинг, HTTP-статус
        log.warning("news source %s failed: %s", source["id"], e)
        return (await _db(store.update, "news_sources", {"id": source["id"]}, {"last_error": str(e)[:300]}))[0]

    def save() -> Row:
        for it in items[:50]:
            # upsert за (source_id, external_id) — дублікати не створюються
            store.upsert("news_items", {
                "source_id": source["id"], "university_id": source["university_id"], "external_id": it.external_id,
                "title": it.title, "summary": it.summary, "url": it.url, "published_at": it.published_at,
                "fetched_at": _now().isoformat(), "is_demo": False,
            }, on_conflict="source_id,external_id")
        return store.update("news_sources", {"id": source["id"]}, {"last_synced_at": _now().isoformat(), "last_error": None})[0]

    return await _db(save)


async def sync_source(store: Store, source: Row) -> Row:
    """Завантажує новини джерела. При помилці зберігає last_error, старі новини лишаються."""
    task = _inflight.get(source["id"])
    if task is None or task.done():
        task = asyncio.ensure_future(_sync_source(store, source))
        _inflight[source["id"]] = task
        task.add_done_callback(lambda _t, sid=source["id"]: _inflight.pop(sid, None))
    return await asyncio.shield(task)


async def news_for(store: Store, university_id: str, limit: int = 10) -> Row:
    sources = await _db(store.select, "news_sources", [("university_id", "eq", university_id), ("is_enabled", "eq", True)])
    stale = [s for s in sources if _is_stale(s)]
    if stale:
        refreshed = await asyncio.gather(*(sync_source(store, s) for s in stale))
        by_id = {s["id"]: s for s in refreshed}
        sources = [by_id.get(s["id"], s) for s in sources]
    items = await _db(lambda: store.select("news_items", [("university_id", "eq", university_id)], order="published_at",
                                           desc=True, limit=limit * 3))
    seen, unique = set(), []
    for it in items:  # дублікати між різними джерелами (той самий заголовок)
        key = it["title"].strip().lower()
        if key not in seen:
            seen.add(key)
            unique.append(it)
    names = {s["id"]: s["name"] for s in sources}
    synced = [s["last_synced_at"] for s in sources if s.get("last_synced_at")]
    return {
        "items": [{**{k: it[k] for k in ("id", "title", "summary", "url", "published_at", "is_demo")},
                   "source": names.get(it["source_id"], "")} for it in unique[:limit]],
        "last_synced_at": max(synced) if synced else None,
        "degraded": any(s.get("last_error") for s in sources),
        "has_sources": bool(sources),
    }


async def periodic_sync(get_store, interval: int) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            store = get_store()
            for s in await _db(store.select, "news_sources", [("is_enabled", "eq", True)]):
                if _is_stale(s):
                    await sync_source(store, s)
        except Exception:
            log.exception("periodic news sync failed")
