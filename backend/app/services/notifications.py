from __future__ import annotations

from app.repositories.store import Store


def notify(store: Store, user_id: str, university_id: str | None, kind: str, title: str, body: str = "", link: str | None = None) -> None:
    store.insert("notifications", {"user_id": user_id, "university_id": university_id, "kind": kind,
                                   "title": title, "body": body, "link": link, "is_read": False})


def list_for(store: Store, user_id: str, limit: int = 50) -> dict:
    items = store.select("notifications", [("user_id", "eq", user_id)], order="created_at", desc=True, limit=limit)
    unread = store.count("notifications", [("user_id", "eq", user_id), ("is_read", "eq", False)])
    return {"items": items, "unread": unread}


def mark_all_read(store: Store, user_id: str) -> None:
    for n in store.select("notifications", [("user_id", "eq", user_id), ("is_read", "eq", False)]):
        store.update("notifications", {"id": n["id"], "user_id": user_id}, {"is_read": True})
