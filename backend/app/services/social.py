"""Публічні профілі та підписки між користувачами (як в Instagram)."""
from __future__ import annotations

from fastapi import HTTPException

from app.repositories.store import Row, Store
from app.services.access import Access
from app.services.notifications import notify


class SocialService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    def _card(self, p: Row, following: set[str]) -> Row:
        return {"id": p["id"], "display_name": p.get("display_name"), "avatar_url": p.get("avatar_url"),
                "bio": (p.get("bio") or "")[:160], "is_following": p["id"] in following, "is_me": p["id"] == self.a.user_id}

    def _my_following(self) -> set[str]:
        return {r["following_id"] for r in self.s.select("follows", [("follower_id", "eq", self.a.user_id)])}

    def profile(self, user_id: str) -> Row:
        if user_id == "me":
            user_id = self.a.user_id
        p = self.s.get("profiles", id=user_id)
        if not p:
            raise HTTPException(404, "Користувача не знайдено")
        followers = self.s.count("follows", [("following_id", "eq", user_id)])
        following = self.s.count("follows", [("follower_id", "eq", user_id)])
        is_following = bool(self.s.select("follows", [("follower_id", "eq", self.a.user_id), ("following_id", "eq", user_id)], limit=1))
        follows_you = bool(self.s.select("follows", [("follower_id", "eq", user_id), ("following_id", "eq", self.a.user_id)], limit=1))
        # Статистика лише по дописах, які бачить поточний користувач
        posts = [x for x in self.s.select("posts", [("author_id", "eq", user_id)]) if self.a.can_view_post(x)]
        memberships = self.s.select("university_memberships", [("user_id", "eq", user_id)])
        shared = [m for m in memberships if m["university_id"] in self.a.memberships]
        context = None
        if shared:
            m = shared[0]
            uni = self.s.get("universities", id=m["university_id"]) or {}
            prog = self.s.get("programs", id=m["program_id"]) if m.get("program_id") else None
            grp = self.s.get("study_groups", id=m["group_id"]) if m.get("group_id") else None
            context = {"university": uni.get("short_name"), "program": prog and f"{prog.get('code') or ''} {prog['name']}".strip(),
                       "group": grp and grp["name"], "course": m.get("course"), "role": m["role"]}
        return {
            "id": p["id"], "display_name": p.get("display_name"), "avatar_url": p.get("avatar_url"), "bio": p.get("bio") or "",
            "telegram": p.get("telegram"), "created_at": p.get("created_at"),
            "followers": followers, "following": following, "posts": len(posts),
            "useful": sum(x.get("useful_count", 0) for x in posts),
            "is_me": user_id == self.a.user_id, "is_following": is_following, "follows_you": follows_you,
            "context": context,
        }

    def toggle_follow(self, user_id: str) -> Row:
        if user_id == self.a.user_id:
            raise HTTPException(400, "Не можна підписатися на себе")
        if not self.s.get("profiles", id=user_id):
            raise HTTPException(404, "Користувача не знайдено")
        key = {"follower_id": self.a.user_id, "following_id": user_id}
        if self.s.select("follows", [(k, "eq", v) for k, v in key.items()], limit=1):
            self.s.delete("follows", key)
            active = False
        else:
            self.s.insert("follows", key)
            active = True
            me = self.a.profile.get("display_name") or "Хтось"
            notify(self.s, user_id, None, "follow", f"{me} підписався(-лась) на вас", "", f"/u/{self.a.user_id}")
        return {"is_following": active, "followers": self.s.count("follows", [("following_id", "eq", user_id)])}

    def list(self, user_id: str, kind: str) -> list[Row]:
        if user_id == "me":
            user_id = self.a.user_id
        col, other = ("following_id", "follower_id") if kind == "followers" else ("follower_id", "following_id")
        ids = [r[other] for r in self.s.select("follows", [(col, "eq", user_id)], order="created_at", desc=True, limit=500)]
        if not ids:
            return []
        profiles = {p["id"]: p for p in self.s.select("profiles", [("id", "in", ids)])}
        mine = self._my_following()
        return [self._card(profiles[i], mine) for i in ids if i in profiles]

    def people(self, university_id: str, q: str | None = None, suggest: bool = False, limit: int = 20) -> list[Row]:
        """Пошук людей у межах університету; suggest — кого ще не читаєте."""
        self.a.require_member(university_id)
        ids = [m["user_id"] for m in self.s.select("university_memberships", [("university_id", "eq", university_id)], limit=2000)]
        f = [("id", "in", ids)]
        if q:
            f.append(("display_name", "search", (["display_name"], q.strip()[:60])))
        profiles = self.s.select("profiles", f, limit=500)
        mine = self._my_following()
        out = [p for p in profiles if p["id"] != self.a.user_id and not (suggest and p["id"] in mine)]
        if suggest:
            counts = {}
            for r in self.s.select("follows", [("following_id", "in", [p["id"] for p in out])]):
                counts[r["following_id"]] = counts.get(r["following_id"], 0) + 1
            out.sort(key=lambda p: counts.get(p["id"], 0), reverse=True)
        return [self._card(p, mine) for p in out[:limit]]
