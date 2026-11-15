"""Профіль, університети, членства, предмети, підписки."""
from __future__ import annotations

from fastapi import HTTPException

from app.core import academic
from app.repositories.store import Row, Store
from app.schemas.content import JoinUniversity, ProfileUpdate
from app.services.access import Access


def _uni_open(u: Row) -> bool:
    return bool((u.get("settings") or {}).get("registration_open", True))


def _faculty_open(f: Row) -> bool:
    return bool(f.get("registration_open", True))


class CatalogService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    # ---------- Навчальний контекст ----------
    def _refresh_membership(self, m: Row) -> Row:
        """Поточний курс від року вступу; група автоматично «переходить» разом із курсом."""
        course = academic.current_course(m)
        m = {**m, "course": course}
        if course and m.get("group_id"):
            grp = self.s.get("study_groups", id=m["group_id"])
            if grp and grp.get("course") and grp["course"] != course:
                new_name = academic.group_for_course(grp["name"], course)
                nxt = self.s.get("study_groups", university_id=m["university_id"], name=new_name) if new_name else None
                if nxt:
                    self.s.update("university_memberships", {"user_id": m["user_id"], "university_id": m["university_id"]},
                                  {"group_id": nxt["id"], "course": course})
                    m["group_id"] = nxt["id"]
        return m

    def my_context(self, university_id: str) -> Row:
        m = self.a.membership(university_id)
        if not m:
            return {}
        m = self._refresh_membership(m)
        return {"program_id": m.get("program_id"), "course": m.get("course")}

    # ---------- Профіль ----------
    def me(self) -> Row:
        p = self.a.profile
        unis = {u["id"]: u for u in self.s.select("universities", [("id", "in", list(self.a.memberships))])} if self.a.memberships else {}
        memberships = []
        for uid, m in self.a.memberships.items():
            m = self._refresh_membership(m)
            u = unis.get(uid, {})
            memberships.append({**m, "university": {"id": uid, "name": u.get("name"), "short_name": u.get("short_name"),
                                                    "is_demo": u.get("is_demo", False)}})
        return {
            "id": p["id"], "display_name": p.get("display_name"), "avatar_url": p.get("avatar_url"), "bio": p.get("bio", ""),
            "telegram": p.get("telegram"), "cover": p.get("cover"),
            "theme": p.get("theme", "system"), "locale": p.get("locale", "uk"),
            "active_university_id": p.get("active_university_id") if p.get("active_university_id") in self.a.memberships else
            (next(iter(self.a.memberships), None)),
            "is_platform_admin": self.a.is_platform_admin, "memberships": memberships,
        }

    def update_me(self, data: ProfileUpdate) -> Row:
        values = data.model_dump(exclude_unset=True)
        for k in ("telegram", "cover"):
            if values.get(k) == "":
                values[k] = None
        if "active_university_id" in values and values["active_university_id"] not in self.a.memberships:
            raise HTTPException(403, "Ви не є учасником цього університету")
        if values:
            self.s.update("profiles", {"id": self.a.user_id}, values)
            self.a._profile = None
        return self.me()

    # ---------- Університети ----------
    def universities(self) -> list[Row]:
        """Для реєстрації — лише університети з відкритою реєстрацією (та ті, де користувач уже є)."""
        rows = self.s.select("universities", order="name")
        visible = [u for u in rows if _uni_open(u) or u["id"] in self.a.memberships or self.a.is_platform_admin]
        return [{k: u[k] for k in ("id", "name", "short_name", "slug", "is_demo")} for u in visible]

    def structure(self, university_id: str) -> Row:
        uni = self.s.get("universities", id=university_id)
        if not uni:
            raise HTTPException(404, "Університет не знайдено")
        f = [("university_id", "eq", university_id)]
        mine = (self.a.membership(university_id) or {}).get("faculty_id")
        faculties = [x for x in self.s.select("faculties", f, order="name")
                     if _faculty_open(x) or x["id"] == mine or self.a.is_platform_admin]
        fac_ids = {x["id"] for x in faculties}
        programs = [p for p in self.s.select("programs", f, order="name") if p["faculty_id"] in fac_ids]
        prog_ids = {p["id"] for p in programs}
        groups = [g for g in self.s.select("study_groups", f, order="name") if g["program_id"] in prog_ids]
        return {"faculties": faculties, "programs": programs, "groups": groups}

    def join(self, university_id: str, data: JoinUniversity) -> Row:
        uni = self.s.get("universities", id=university_id)
        if not uni:
            raise HTTPException(404, "Університет не знайдено")
        existing = self.a.membership(university_id)
        if not existing and not _uni_open(uni) and not self.a.is_platform_admin:
            raise HTTPException(403, "Реєстрація в цьому університеті поки закрита")
        if not (data.faculty_id and data.program_id and data.course):
            raise HTTPException(400, "Оберіть факультет, спеціальність і курс")
        checks = (("faculties", data.faculty_id), ("programs", data.program_id), ("study_groups", data.group_id))
        rows = {}
        for table, oid in checks:
            if oid:
                row = self.s.get(table, id=oid)
                if not row or row["university_id"] != university_id:
                    raise HTTPException(400, "Обраний підрозділ не належить університету")
                rows[table] = row
        fac = rows["faculties"]
        if not _faculty_open(fac) and fac["id"] != (existing or {}).get("faculty_id") and not self.a.is_platform_admin:
            raise HTTPException(403, "Реєстрація на цьому факультеті поки закрита")
        if rows["programs"]["faculty_id"] != data.faculty_id:
            raise HTTPException(400, "Спеціальність не належить факультету")
        if data.group_id and rows["study_groups"]["program_id"] != data.program_id:
            raise HTTPException(400, "Група не належить спеціальності")
        context = {"faculty_id": data.faculty_id, "program_id": data.program_id, "group_id": data.group_id,
                   "course": data.course, "entry_year": academic.entry_from_course(data.course), "onboarded": True}
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
    def subjects(self, university_id: str, q: str | None = None, mine: bool = False, scope: str = "all") -> list[Row]:
        """scope: all — усі предмети; program — моєї спеціальності; course — моєї спеціальності на моєму курсі."""
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
        ctx = self.my_context(university_id) if scope in ("program", "course") else {}
        out = []
        for r in rows:
            if mine and r["id"] not in subs:
                continue
            sp = [x for x in links if x["subject_id"] == r["id"]]
            courses_all = sorted({c for x in sp for c in (x.get("courses") or ([x["course"]] if x.get("course") else []))})
            if ctx.get("program_id"):
                own = [x for x in sp if x["program_id"] == ctx["program_id"]]
                if not own:
                    continue
                own_courses = {c for x in own for c in (x.get("courses") or ([x["course"]] if x.get("course") else []))}
                if scope == "course" and ctx.get("course") and own_courses and ctx["course"] not in own_courses:
                    continue
                elective = all(x.get("is_elective") for x in own)
            else:
                elective = bool(sp) and all(x.get("is_elective") for x in sp)
            out.append({**r, "subscribed": r["id"] in subs, "post_count": counts.get(r["id"], 0),
                        "courses": courses_all,
                        "semesters": sorted({s for x in sp for s in (x.get("semesters") or ([x["semester"]] if x.get("semester") else []))}),
                        "program_ids": [x["program_id"] for x in sp], "is_elective": elective})
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
