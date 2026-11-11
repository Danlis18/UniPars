"""Профіль, університети, членства, предмети, підписки."""
from __future__ import annotations

from fastapi import HTTPException

from app.repositories.store import Row, Store
from app.schemas.content import JoinUniversity, ProfileUpdate
from app.services.access import Access


class CatalogService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    # ---------- Профіль ----------
    def me(self) -> Row:
        p = self.a.profile
        unis = {u["id"]: u for u in self.s.select("universities", [("id", "in", list(self.a.memberships))])} if self.a.memberships else {}
        memberships = []
        for uid, m in self.a.memberships.items():
            u = unis.get(uid, {})
            memberships.append({**m, "university": {"id": uid, "name": u.get("name"), "short_name": u.get("short_name"),
                                                    "is_demo": u.get("is_demo", False)}})
        return {
            "id": p["id"], "display_name": p.get("display_name"), "avatar_url": p.get("avatar_url"), "bio": p.get("bio", ""), "telegram": p.get("telegram"),
            "theme": p.get("theme", "system"), "locale": p.get("locale", "uk"),
            "active_university_id": p.get("active_university_id") if p.get("active_university_id") in self.a.memberships else
            (next(iter(self.a.memberships), None)),
            "is_platform_admin": self.a.is_platform_admin, "memberships": memberships,
        }

    def update_me(self, data: ProfileUpdate) -> Row:
        values = data.model_dump(exclude_unset=True)
        if values.get("telegram") == "":
            values["telegram"] = None
        if "active_university_id" in values and values["active_university_id"] not in self.a.memberships:
            raise HTTPException(403, "Ви не є учасником цього університету")
        if values:
            self.s.update("profiles", {"id": self.a.user_id}, values)
            self.a._profile = None
        return self.me()

    # ---------- Університети ----------
    def universities(self) -> list[Row]:
        return [{k: u[k] for k in ("id", "name", "short_name", "slug", "is_demo")}
                for u in self.s.select("universities", order="name")]

    def structure(self, university_id: str) -> Row:
        if not self.s.get("universities", id=university_id):
            raise HTTPException(404, "Університет не знайдено")
        f = [("university_id", "eq", university_id)]
        return {"faculties": self.s.select("faculties", f, order="name"),
                "programs": self.s.select("programs", f, order="name"),
                "groups": self.s.select("study_groups", f, order="name")}

    def join(self, university_id: str, data: JoinUniversity) -> Row:
        if not self.s.get("universities", id=university_id):
            raise HTTPException(404, "Університет не знайдено")
        checks = (("faculties", data.faculty_id), ("programs", data.program_id), ("study_groups", data.group_id))
        for table, oid in checks:
            if oid:
                row = self.s.get(table, id=oid)
                if not row or row["university_id"] != university_id:
                    raise HTTPException(400, "Обраний підрозділ не належить університету")
        if data.program_id and data.faculty_id:
            prog = self.s.get("programs", id=data.program_id)
            if prog["faculty_id"] != data.faculty_id:
                raise HTTPException(400, "Спеціальність не належить факультету")
        if data.group_id and data.program_id:
            grp = self.s.get("study_groups", id=data.group_id)
            if grp["program_id"] != data.program_id:
                raise HTTPException(400, "Група не належить спеціальності")
        context = {"faculty_id": data.faculty_id, "program_id": data.program_id, "group_id": data.group_id,
                   "course": data.course, "onboarded": True}
        existing = self.a.membership(university_id)
        if existing:
            # Роль не змінюється: оновлюємо лише навчальний контекст
            self.s.update("university_memberships", {"user_id": self.a.user_id, "university_id": university_id}, context)
        else:
            self.s.insert("university_memberships", {"user_id": self.a.user_id, "university_id": university_id,
                                                     "role": "student", **context})
        self.s.update("profiles", {"id": self.a.user_id}, {"active_university_id": university_id})
        self.a._memberships = None
        self.a._profile = None
        return self.me()

    # ---------- Предмети ----------
    def subjects(self, university_id: str, q: str | None = None, mine: bool = False) -> list[Row]:
        self.a.require_member(university_id)
        f = [("university_id", "eq", university_id)]
        if q:
            f.append(("name", "search", (["name", "description"], q.strip()[:80])))
        rows = self.s.select("subjects", f, order="name")
        subs = {r["subject_id"] for r in self.s.select("subject_subscriptions", [("user_id", "eq", self.a.user_id)])}
        posts = self.s.select("posts", [("university_id", "eq", university_id)])
        counts: dict[str, int] = {}
        for p in posts:
            if self.a.can_view_post(p):
                counts[p["subject_id"]] = counts.get(p["subject_id"], 0) + 1
        links = self.s.select("subject_programs", [("university_id", "eq", university_id)])
        out = []
        for r in rows:
            if mine and r["id"] not in subs:
                continue
            sp = [x for x in links if x["subject_id"] == r["id"]]
            out.append({**r, "subscribed": r["id"] in subs, "post_count": counts.get(r["id"], 0),
                        "courses": sorted({x["course"] for x in sp if x.get("course")}),
                        "semesters": sorted({x["semester"] for x in sp if x.get("semester")}),
                        "program_ids": [x["program_id"] for x in sp]})
        return out

    def subject(self, university_id: str, key: str) -> Row:
        self.a.require_member(university_id)
        row = self.s.get("subjects", id=key) if len(key) == 36 else None
        row = row or self.s.get("subjects", university_id=university_id, slug=key)
        if not row or row["university_id"] != university_id:
            raise HTTPException(404, "Предмет не знайдено")
        topics = self.s.select("topics", [("subject_id", "eq", row["id"])], order="position")
        sub = self.s.select("subject_subscriptions", [("user_id", "eq", self.a.user_id), ("subject_id", "eq", row["id"])], limit=1)
        followers = self.s.count("subject_subscriptions", [("subject_id", "eq", row["id"])])
        return {**row, "topics": topics, "subscribed": bool(sub), "followers": followers}

    def toggle_subscription(self, subject_id: str) -> Row:
        subj = self.s.get("subjects", id=subject_id)
        if not subj:
            raise HTTPException(404, "Предмет не знайдено")
        self.a.require_member(subj["university_id"])
        key = {"user_id": self.a.user_id, "subject_id": subject_id}
        if self.s.select("subject_subscriptions", [(k, "eq", v) for k, v in key.items()], limit=1):
            self.s.delete("subject_subscriptions", key)
            return {"subscribed": False}
        self.s.insert("subject_subscriptions", key)
        return {"subscribed": True}

    def set_subscriptions(self, university_id: str, subject_ids: list[str]) -> Row:
        self.a.require_member(university_id)
        valid = {r["id"] for r in self.s.select("subjects", [("university_id", "eq", university_id), ("id", "in", subject_ids)])}
        current = {r["subject_id"] for r in self.s.select("subject_subscriptions", [("user_id", "eq", self.a.user_id)])}
        uni_subjects = {r["id"] for r in self.s.select("subjects", [("university_id", "eq", university_id)])}
        for sid in (current & uni_subjects) - valid:
            self.s.delete("subject_subscriptions", {"user_id": self.a.user_id, "subject_id": sid})
        for sid in valid - current:
            self.s.insert("subject_subscriptions", {"user_id": self.a.user_id, "subject_id": sid})
        return {"subject_ids": sorted(valid)}
