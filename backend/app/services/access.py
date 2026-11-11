"""Єдине місце перевірки прав доступу (дзеркало політик RLS)."""
from __future__ import annotations

from fastapi import HTTPException

from app.repositories.store import Row, Store

STAFF = ("moderator", "admin")


class Access:
    def __init__(self, store: Store, user_id: str) -> None:
        self.store = store
        self.user_id = user_id
        self._profile: Row | None = None
        self._memberships: dict[str, Row] | None = None

    @property
    def profile(self) -> Row:
        if self._profile is None:
            self._profile = self.store.get("profiles", id=self.user_id) or {}
        return self._profile

    @property
    def is_platform_admin(self) -> bool:
        return bool(self.profile.get("is_platform_admin"))

    @property
    def memberships(self) -> dict[str, Row]:
        if self._memberships is None:
            rows = self.store.select("university_memberships", [("user_id", "eq", self.user_id)])
            self._memberships = {r["university_id"]: r for r in rows}
        return self._memberships

    def membership(self, university_id: str) -> Row | None:
        return self.memberships.get(university_id)

    def role(self, university_id: str) -> str | None:
        if self.is_platform_admin:
            return "admin"
        m = self.membership(university_id)
        return m["role"] if m else None

    def require_member(self, university_id: str) -> Row:
        m = self.membership(university_id)
        if not m and not self.is_platform_admin:
            raise HTTPException(403, "Ви не є учасником цього університету")
        return m or {"role": "admin", "university_id": university_id, "group_id": None}

    def require_role(self, university_id: str, roles: tuple[str, ...]) -> None:
        if self.role(university_id) not in roles:
            raise HTTPException(403, "Недостатньо прав")

    def is_staff(self, university_id: str) -> bool:
        return self.role(university_id) in STAFF

    def can_view_post(self, post: Row) -> bool:
        if self.is_platform_admin or post["author_id"] == self.user_id:
            return True
        m = self.membership(post["university_id"])
        if not m:
            return False
        if post.get("is_hidden") and m["role"] not in STAFF:
            return False
        if post["visibility"] == "group":
            return m.get("group_id") == post.get("group_id")
        return True

    def get_post(self, post_id: str) -> Row:
        post = self.store.get("posts", id=post_id)
        # 404 замість 403, щоб не розкривати існування приватних матеріалів
        if not post or not self.can_view_post(post):
            raise HTTPException(404, "Допис не знайдено")
        return post

    def require_post_owner(self, post: Row) -> None:
        if post["author_id"] != self.user_id:
            raise HTTPException(403, "Редагувати може лише автор")

    def require_same_university(self, university_id: str, *rows: Row | None) -> None:
        for r in rows:
            if r is not None and r.get("university_id") != university_id:
                raise HTTPException(400, "Об'єкти належать різним університетам")
