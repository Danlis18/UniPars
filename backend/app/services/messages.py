"""Особисті повідомлення 1:1.

Правило доступу (захист від спаму): почати діалог можна лише з тим, хто на вас
підписаний. Якщо співрозмовник уже відповів у діалозі, листування триває навіть
після відписки.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.repositories.store import Row, Store
from app.services.access import Access
from app.services.ai import RateLimiter

send_limiter = RateLimiter()
MAX_LEN = 4000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts(v: str | None) -> datetime:
    if not v:
        return datetime.min.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


def _pair(a: str, b: str) -> str:
    return ":".join(sorted((a, b)))


class MessageService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access
        self.me = access.user_id

    # ---------- Дозволи ----------
    def _follows_me(self, other: str) -> bool:
        return bool(self.s.select("follows", [("follower_id", "eq", other), ("following_id", "eq", self.me)], limit=1))

    def can_start(self, other: str) -> bool:
        return other != self.me and self._follows_me(other)

    def _member(self, conversation_id: str) -> Row:
        m = self.s.get("dm_members", conversation_id=conversation_id, user_id=self.me)
        if not m:
            raise HTTPException(404, "Діалог не знайдено")
        return m

    def _other_id(self, conversation_id: str) -> str | None:
        rows = self.s.select("dm_members", [("conversation_id", "eq", conversation_id)])
        return next((r["user_id"] for r in rows if r["user_id"] != self.me), None)

    def _profile_card(self, uid: str | None) -> Row:
        p = self.s.get("profiles", id=uid) if uid else None
        if not p:
            return {"id": uid, "display_name": "Видалений акаунт", "avatar_url": None}
        return {"id": p["id"], "display_name": p.get("display_name"), "avatar_url": p.get("avatar_url")}

    # ---------- Діалоги ----------
    def conversations(self) -> list[Row]:
        mine = self.s.select("dm_members", [("user_id", "eq", self.me)])
        if not mine:
            return []
        read_at = {m["conversation_id"]: m["last_read_at"] for m in mine}
        convs = self.s.select("dm_conversations", [("id", "in", list(read_at))], order="last_message_at", desc=True)
        out = []
        for c in convs:
            other = self._other_id(c["id"])
            last = self.s.select("dm_messages", [("conversation_id", "eq", c["id"])], order="created_at", desc=True, limit=1)
            recent = self.s.select("dm_messages", [("conversation_id", "eq", c["id"])], order="created_at", desc=True, limit=50)
            unread = sum(1 for m in recent if m["sender_id"] != self.me and _ts(m["created_at"]) > _ts(read_at[c["id"]]))
            out.append({
                "id": c["id"], "user": self._profile_card(other), "last_message_at": c["last_message_at"],
                "last_message": {"body": last[0]["body"][:140], "from_me": last[0]["sender_id"] == self.me} if last else None,
                "unread": unread,
            })
        return out

    def unread_total(self) -> int:
        return sum(c["unread"] for c in self.conversations())

    def open_with(self, other: str) -> Row:
        if other == self.me:
            raise HTTPException(400, "Не можна написати самому собі")
        if not self.s.get("profiles", id=other):
            raise HTTPException(404, "Користувача не знайдено")
        conv = self.s.get("dm_conversations", pair_key=_pair(self.me, other))
        if not conv:
            if not self.can_start(other):
                raise HTTPException(403, "Написати можна лише тому, хто на вас підписаний")
            conv = self.s.insert("dm_conversations", {"pair_key": _pair(self.me, other), "created_at": _now(), "last_message_at": _now()})
            for uid in (self.me, other):
                self.s.insert("dm_members", {"conversation_id": conv["id"], "user_id": uid, "last_read_at": _now()})
        return {"id": conv["id"], "user": self._profile_card(other), "can_send": self._can_send(conv["id"], other)}

    def get(self, conversation_id: str) -> Row:
        self._member(conversation_id)
        other = self._other_id(conversation_id)
        return {"id": conversation_id, "user": self._profile_card(other), "can_send": self._can_send(conversation_id, other)}

    def _can_send(self, conversation_id: str, other: str | None) -> bool:
        if not other:
            return False
        if self._follows_me(other):
            return True
        return bool(self.s.select("dm_messages", [("conversation_id", "eq", conversation_id), ("sender_id", "eq", other)], limit=1))

    # ---------- Повідомлення ----------
    def messages(self, conversation_id: str, limit: int = 100) -> list[Row]:
        self._member(conversation_id)
        rows = self.s.select("dm_messages", [("conversation_id", "eq", conversation_id)], order="created_at", desc=True, limit=limit)
        rows.reverse()
        return [{**r, "from_me": r["sender_id"] == self.me} for r in rows]

    def send(self, conversation_id: str, body: str) -> Row:
        self._member(conversation_id)
        body = (body or "").strip()
        if not body:
            raise HTTPException(400, "Порожнє повідомлення")
        if len(body) > MAX_LEN:
            raise HTTPException(400, f"Повідомлення довше {MAX_LEN} символів")
        other = self._other_id(conversation_id)
        if not self._can_send(conversation_id, other):
            raise HTTPException(403, "Співрозмовник більше не підписаний на вас")
        send_limiter.check(self.me, 30)
        now = _now()
        msg = self.s.insert("dm_messages", {"conversation_id": conversation_id, "sender_id": self.me, "body": body, "created_at": now})
        self.s.update("dm_conversations", {"id": conversation_id}, {"last_message_at": now})
        self.s.update("dm_members", {"conversation_id": conversation_id, "user_id": self.me}, {"last_read_at": now})
        return {**msg, "from_me": True}

    def mark_read(self, conversation_id: str) -> None:
        self._member(conversation_id)
        self.s.update("dm_members", {"conversation_id": conversation_id, "user_id": self.me}, {"last_read_at": _now()})
