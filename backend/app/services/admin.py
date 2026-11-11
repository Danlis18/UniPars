"""Адміністрування університету та модерація. Усі операції перевіряють роль на backend."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import HTTPException

from app.repositories.store import Row, Store
from app.schemas import admin_ai as S
from app.services.access import Access, STAFF
from app.services.notifications import notify

ADMIN = ("admin",)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AdminService:
    def __init__(self, store: Store, access: Access, university_id: str) -> None:
        self.s = store
        self.a = access
        self.uni = university_id

    def _admin(self):
        self.a.require_role(self.uni, ADMIN)

    def _staff(self):
        self.a.require_role(self.uni, STAFF)

    # ---------- Огляд ----------
    def overview(self) -> Row:
        self._staff()
        f = [("university_id", "eq", self.uni)]
        return {
            "role": self.a.role(self.uni),
            "university": self.s.get("universities", id=self.uni),
            "members": self.s.count("university_memberships", f),
            "posts": self.s.count("posts", f),
            "open_reports": self.s.count("reports", f + [("status", "eq", "open")]),
        }

    # ---------- Учасники ----------
    def members(self) -> list[Row]:
        self._admin()
        rows = self.s.select("university_memberships", [("university_id", "eq", self.uni)])
        profiles = {p["id"]: p for p in self.s.select("profiles", [("id", "in", [r["user_id"] for r in rows])])}
        return [{**r, "display_name": profiles.get(r["user_id"], {}).get("display_name")} for r in rows]

    def set_role(self, user_id: str, data: S.MemberRoleUpdate) -> Row:
        self._admin()
        if user_id == self.a.user_id and not self.a.is_platform_admin:
            raise HTTPException(400, "Не можна змінити власну роль")
        rows = self.s.update("university_memberships", {"user_id": user_id, "university_id": self.uni}, {"role": data.role})
        if not rows:
            raise HTTPException(404, "Учасника не знайдено")
        return rows[0]

    # ---------- Структура та каталог ----------
    def add_faculty(self, data: S.FacultyCreate) -> Row:
        self._admin()
        return self.s.insert("faculties", {"university_id": self.uni, "name": data.name})

    def add_program(self, data: S.ProgramCreate) -> Row:
        self._admin()
        fac = self.s.get("faculties", id=data.faculty_id)
        self.a.require_same_university(self.uni, fac or {"university_id": None})
        return self.s.insert("programs", {"university_id": self.uni, "faculty_id": data.faculty_id, "name": data.name, "code": data.code})

    def add_group(self, data: S.GroupCreate) -> Row:
        self._admin()
        prog = self.s.get("programs", id=data.program_id)
        self.a.require_same_university(self.uni, prog or {"university_id": None})
        return self.s.insert("study_groups", {"university_id": self.uni, "program_id": data.program_id, "name": data.name, "course": data.course})

    def add_subject(self, data: S.SubjectCreate) -> Row:
        self._admin()
        if self.s.get("subjects", university_id=self.uni, slug=data.slug):
            raise HTTPException(409, "Предмет з такою адресою вже існує")
        subj = self.s.insert("subjects", {"university_id": self.uni, "slug": data.slug, "name": data.name, "description": data.description})
        for pid in data.program_ids:
            prog = self.s.get("programs", id=pid)
            self.a.require_same_university(self.uni, prog or {"university_id": None})
            self.s.insert("subject_programs", {"subject_id": subj["id"], "program_id": pid, "university_id": self.uni,
                                               "course": data.course, "semester": data.semester})
        return subj

    def add_topic(self, subject_id: str, data: S.TopicCreate) -> Row:
        self._staff()
        subj = self.s.get("subjects", id=subject_id)
        self.a.require_same_university(self.uni, subj or {"university_id": None})
        pos = self.s.count("topics", [("subject_id", "eq", subject_id)])
        return self.s.insert("topics", {"university_id": self.uni, "subject_id": subject_id, "name": data.name, "position": pos})

    def update_settings(self, settings: dict) -> Row:
        self._admin()
        uni = self.s.get("universities", id=self.uni)
        allowed = {k: v for k, v in settings.items() if k in ("max_upload_mb",)}
        # cross_university_sharing вмикає лише адміністратор платформи
        if "cross_university_sharing" in settings and self.a.is_platform_admin:
            allowed["cross_university_sharing"] = bool(settings["cross_university_sharing"])
        return self.s.update("universities", {"id": self.uni}, {"settings": {**(uni.get("settings") or {}), **allowed}})[0]

    # ---------- Новини ----------
    def sources(self) -> list[Row]:
        self._admin()
        return self.s.select("news_sources", [("university_id", "eq", self.uni)], order="created_at")

    def add_source(self, data: S.NewsSourceIn) -> Row:
        self._admin()
        if data.kind != "manual" and not data.url:
            raise HTTPException(400, "Для API та RSS потрібна адреса джерела")
        return self.s.insert("news_sources", {"university_id": self.uni, "kind": data.kind, "name": data.name,
                                              "url": str(data.url) if data.url else None, "config": data.config,
                                              "is_enabled": data.is_enabled, "refresh_minutes": data.refresh_minutes,
                                              "last_synced_at": None, "last_error": None})

    def _source(self, source_id: str) -> Row:
        src = self.s.get("news_sources", id=source_id)
        if not src or src["university_id"] != self.uni:
            raise HTTPException(404, "Джерело не знайдено")
        return src

    def update_source(self, source_id: str, data: S.NewsSourceIn) -> Row:
        self._admin()
        self._source(source_id)
        return self.s.update("news_sources", {"id": source_id}, {
            "name": data.name, "url": str(data.url) if data.url else None, "config": data.config,
            "is_enabled": data.is_enabled, "refresh_minutes": data.refresh_minutes, "last_synced_at": None})[0]

    def delete_source(self, source_id: str) -> None:
        self._admin()
        self._source(source_id)
        self.s.delete("news_items", {"source_id": source_id})
        self.s.delete("news_sources", {"id": source_id})

    def announce(self, data: S.AnnouncementIn) -> Row:
        self._admin()
        src = next((s for s in self.s.select("news_sources", [("university_id", "eq", self.uni), ("kind", "eq", "manual")])), None)
        if not src:
            src = self.s.insert("news_sources", {"university_id": self.uni, "kind": "manual", "name": "Оголошення адміністрації",
                                                 "url": None, "config": {}, "is_enabled": True, "refresh_minutes": 30,
                                                 "last_synced_at": _now(), "last_error": None})
        ext = hashlib.sha1(f"{data.title}|{_now()}".encode()).hexdigest()
        return self.s.insert("news_items", {"source_id": src["id"], "university_id": self.uni, "external_id": ext,
                                            "title": data.title, "summary": data.summary, "url": str(data.url) if data.url else None,
                                            "published_at": _now(), "fetched_at": _now(), "is_demo": False})

    # ---------- Модерація ----------
    def reports(self, status: str = "open") -> list[Row]:
        self._staff()
        rows = self.s.select("reports", [("university_id", "eq", self.uni), ("status", "eq", status)], order="created_at", desc=True)
        out = []
        for r in rows:
            table = "posts" if r["target_type"] == "post" else "comments"
            t = self.s.get(table, id=r["target_id"]) or {}
            out.append({**r, "target_preview": (t.get("title") or t.get("body") or "(видалено)")[:200],
                        "post_id": t.get("id") if r["target_type"] == "post" else t.get("post_id")})
        return out

    def resolve(self, report_id: str, data: S.ReportResolve) -> Row:
        self._staff()
        r = self.s.get("reports", id=report_id)
        if not r or r["university_id"] != self.uni:
            raise HTTPException(404, "Скаргу не знайдено")
        if data.action == "hide":
            table = "posts" if r["target_type"] == "post" else "comments"
            self.s.update(table, {"id": r["target_id"], "university_id": self.uni}, {"is_hidden": True})
        row = self.s.update("reports", {"id": report_id}, {"status": "resolved" if data.action == "hide" else "dismissed",
                                                           "resolved_by": self.a.user_id})[0]
        notify(self.s, r["reporter_id"], self.uni, "report_resolved", "Вашу скаргу розглянуто",
               "Вміст приховано." if data.action == "hide" else "Порушень не виявлено.")
        return row


def create_university(store: Store, access: Access, data: S.UniversityCreate) -> Row:
    if not access.is_platform_admin:
        raise HTTPException(403, "Лише адміністратор платформи")
    if store.get("universities", slug=data.slug):
        raise HTTPException(409, "Університет з такою адресою вже існує")
    return store.insert("universities", {"slug": data.slug, "name": data.name, "short_name": data.short_name,
                                         "is_demo": False, "settings": {"cross_university_sharing": False, "max_upload_mb": 25}})
