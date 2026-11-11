"""Дописи, матеріали, запитання, коментарі, реакції, закладки, скарги."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.repositories.store import Row, Store
from app.schemas.content import CommentCreate, PostCreate, PostUpdate, ReportCreate
from app.services.access import Access
from app.services.notifications import notify

ALLOWED_TYPES = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WEBP", "image/gif": "GIF",
    "application/zip": "ZIP", "application/x-zip-compressed": "ZIP",
}
EXT = {".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip"}
# Магічні байти: не довіряємо лише MIME-типу від браузера
MAGIC = {"PDF": [b"%PDF"], "DOCX": [b"PK"], "PPTX": [b"PK"], "ZIP": [b"PK"], "PNG": [b"\x89PNG"],
         "JPG": [b"\xff\xd8"], "WEBP": [b"RIFF"], "GIF": [b"GIF8"]}
PREVIEWABLE = {"PDF", "PNG", "JPG", "WEBP", "GIF"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PostService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    # ---------- Збагачення для API ----------
    def _profiles(self, ids: set[str]) -> dict[str, Row]:
        if not ids:
            return {}
        rows = self.s.select("profiles", [("id", "in", list(ids))])
        return {r["id"]: {"id": r["id"], "display_name": r["display_name"], "avatar_url": r.get("avatar_url")} for r in rows}

    def enrich(self, posts: list[Row], full: bool = False) -> list[Row]:
        if not posts:
            return []
        ids = [p["id"] for p in posts]
        authors = self._profiles({p["author_id"] for p in posts})
        subjects = {r["id"]: r for r in self.s.select("subjects", [("id", "in", list({p["subject_id"] for p in posts}))])}
        topic_ids = [p["topic_id"] for p in posts if p.get("topic_id")]
        topics = {r["id"]: r for r in self.s.select("topics", [("id", "in", topic_ids)])} if topic_ids else {}
        materials = {r["post_id"]: r for r in self.s.select("material_details", [("post_id", "in", ids)])}
        questions = {r["post_id"]: r for r in self.s.select("question_details", [("post_id", "in", ids)])} if full else {}
        atts: dict[str, list] = {}
        for r in self.s.select("attachments", [("post_id", "in", ids)], order="created_at"):
            atts.setdefault(r["post_id"], []).append(self._att_out(r))
        liked = {r["target_id"] for r in self.s.select("reactions", [("user_id", "eq", self.a.user_id), ("target_type", "eq", "post"), ("target_id", "in", ids)])}
        saved = {r["post_id"] for r in self.s.select("bookmarks", [("user_id", "eq", self.a.user_id), ("post_id", "in", ids)])}
        out = []
        for p in posts:
            subj = subjects.get(p["subject_id"], {})
            t = topics.get(p.get("topic_id"))
            item = {
                **{k: p[k] for k in ("id", "university_id", "type", "title", "visibility", "status", "accepted_comment_id",
                                     "useful_count", "comment_count", "created_at", "updated_at", "is_demo", "is_hidden")},
                "body": p["body"] if full else p["body"][:400],
                "truncated": not full and len(p["body"]) > 400,
                "author": authors.get(p["author_id"], {"id": p["author_id"], "display_name": "Користувач"}),
                "subject": {"id": subj.get("id"), "name": subj.get("name"), "slug": subj.get("slug")},
                "topic": {"id": t["id"], "name": t["name"]} if t else None,
                "material": materials.get(p["id"]),
                "question": questions.get(p["id"]) if full else None,
                "attachments": atts.get(p["id"], []),
                "is_mine": p["author_id"] == self.a.user_id,
                "liked": p["id"] in liked,
                "saved": p["id"] in saved,
            }
            out.append(item)
        return out

    @staticmethod
    def _att_out(r: Row) -> Row:
        fmt = ALLOWED_TYPES.get(r["mime_type"], r["file_name"].rsplit(".", 1)[-1].upper())
        return {"id": r["id"], "file_name": r["file_name"], "mime_type": r["mime_type"], "size_bytes": r["size_bytes"],
                "format": fmt, "previewable": fmt in PREVIEWABLE}

    # ---------- Стрічка ----------
    def list(self, university_id: str, *, tab: str = "university", type: str | None = None, subject_id: str | None = None,
             topic_id: str | None = None, status: str | None = None, q: str | None = None, kind: str | None = None,
             course: int | None = None, semester: int | None = None, saved: bool = False, author: str | None = None, author_id: str | None = None,
             sort: str = "new", offset: int = 0, limit: int = 20) -> Row:
        m = self.a.require_member(university_id)
        f = [("university_id", "eq", university_id)]
        if type:
            f.append(("type", "eq", type))
        if subject_id:
            f.append(("subject_id", "eq", subject_id))
        if topic_id:
            f.append(("topic_id", "eq", topic_id))
        if q and q.strip():
            f.append(("title", "search", (["title", "body"], q.strip()[:100])))
        if status in ("open", "solved"):
            f.append(("status", "eq", status))
        if status == "unanswered":
            f += [("type", "eq", "question"), ("comment_count", "eq", 0)]
        if author == "me":
            f.append(("author_id", "eq", self.a.user_id))
        if author_id:
            f.append(("author_id", "eq", author_id))
        if tab == "following":
            followed = [r["following_id"] for r in self.s.select("follows", [("follower_id", "eq", self.a.user_id)])]
            f.append(("author_id", "in", followed))
        if saved:
            ids = [b["post_id"] for b in self.s.select("bookmarks", [("user_id", "eq", self.a.user_id)])]
            f.append(("id", "in", ids))

        posts = self.s.select("posts", f, order="created_at", desc=True, limit=500)
        posts = [p for p in posts if self.a.can_view_post(p)]

        if kind or course or semester:
            mats = {r["post_id"]: r for r in self.s.select("material_details", [("post_id", "in", [p["id"] for p in posts])])}
            def ok(p):
                md = mats.get(p["id"])
                return md and (not kind or md["kind"] == kind) and (not course or md.get("course") == course) \
                    and (not semester or md.get("semester") == semester)
            posts = [p for p in posts if ok(p)]

        if tab in ("for_me", "my_subjects"):
            subs = {r["subject_id"] for r in self.s.select("subject_subscriptions", [("user_id", "eq", self.a.user_id)])}
            program_subjects = set()
            if m.get("program_id"):
                program_subjects = {r["subject_id"] for r in self.s.select("subject_programs", [("program_id", "eq", m["program_id"])])}
            if tab == "my_subjects":
                posts = [p for p in posts if p["subject_id"] in subs]
            else:
                # Прості зрозумілі правила: підписка > спеціальність > свіжість > корисність
                now = datetime.now(timezone.utc)
                followed_authors = {r["following_id"] for r in self.s.select("follows", [("follower_id", "eq", self.a.user_id)])}
                def score(p):
                    age_h = (now - datetime.fromisoformat(p["created_at"])).total_seconds() / 3600
                    s = 0.0
                    s += 30 if p["subject_id"] in subs else 0
                    s += 15 if p["subject_id"] in program_subjects else 0
                    s += 10 if p.get("visibility") == "group" else 0
                    s += min(p.get("useful_count", 0), 40) * 0.5
                    s += 8 if p["type"] == "question" and p.get("status") == "open" else 0
                    s += 20 if p["author_id"] in followed_authors else 0
                    return s - age_h * 0.25
                posts.sort(key=score, reverse=True)
        elif sort == "popular":
            posts.sort(key=lambda p: p.get("useful_count", 0), reverse=True)

        total = len(posts)
        page = posts[offset: offset + limit]
        return {"items": self.enrich(page), "next_offset": offset + limit if offset + limit < total else None, "total": total}

    def get(self, post_id: str) -> Row:
        return self.enrich([self.a.get_post(post_id)], full=True)[0]

    # ---------- Створення / редагування ----------
    def create(self, university_id: str, data: PostCreate) -> Row:
        m = self.a.require_member(university_id)
        subject = self.s.get("subjects", id=data.subject_id)
        if not subject:
            raise HTTPException(400, "Предмет не знайдено")
        topic = self.s.get("topics", id=data.topic_id) if data.topic_id else None
        if data.topic_id and (not topic or topic["subject_id"] != subject["id"]):
            raise HTTPException(400, "Тема не належить предмету")
        self.a.require_same_university(university_id, subject, topic)
        group_id = None
        if data.visibility == "group":
            group_id = m.get("group_id")
            if not group_id:
                raise HTTPException(400, "Щоб публікувати для групи, вкажіть групу в профілі")
        if data.type == "material" and not data.material:
            raise HTTPException(400, "Вкажіть тип матеріалу")
        if data.material and data.material.kind == "link" and not data.material.link_url:
            raise HTTPException(400, "Для корисного посилання потрібна адреса")

        pid = str(uuid.uuid4())
        self.s.insert("posts", {
            "id": pid, "university_id": university_id, "author_id": self.a.user_id, "type": data.type,
            "subject_id": subject["id"], "topic_id": topic["id"] if topic else None, "title": data.title.strip(),
            "body": data.body, "visibility": data.visibility, "group_id": group_id,
            "status": "open" if data.type == "question" else None, "accepted_comment_id": None, "is_hidden": False,
            "is_demo": False, "useful_count": 0, "comment_count": 0, "created_at": _now(), "updated_at": _now(),
        })
        if data.type == "material" and data.material:
            self.s.insert("material_details", {
                "post_id": pid, "university_id": university_id, "kind": data.material.kind,
                "link_url": str(data.material.link_url) if data.material.link_url else None,
                "course": data.material.course, "semester": data.material.semester, "program_id": m.get("program_id"),
            })
        if data.type == "question":
            q = data.question or None
            self.s.insert("question_details", {"post_id": pid, "university_id": university_id,
                                               "tried": q.tried if q else "", "unclear_step": q.unclear_step if q else ""})
        return self.get(pid)

    def update(self, post_id: str, data: PostUpdate) -> Row:
        post = self.a.get_post(post_id)
        self.a.require_post_owner(post)
        values = {k: v for k, v in data.model_dump(exclude_unset=True).items()}
        if "topic_id" in values and values["topic_id"]:
            t = self.s.get("topics", id=values["topic_id"])
            if not t or t["subject_id"] != post["subject_id"]:
                raise HTTPException(400, "Тема не належить предмету")
        values["updated_at"] = _now()
        self.s.update("posts", {"id": post_id}, values)
        return self.get(post_id)

    def delete(self, post_id: str, storage) -> None:
        post = self.a.get_post(post_id)
        if post["author_id"] != self.a.user_id and not self.a.is_staff(post["university_id"]):
            raise HTTPException(403, "Видаляти може автор або модератор")
        for att in self.s.select("attachments", [("post_id", "eq", post_id)]):
            try:
                storage.remove(att["storage_path"])
            except Exception:
                pass
        for t in ("attachments", "material_details", "question_details", "bookmarks"):
            self.s.delete(t, {"post_id": post_id})
        self.s.delete("comments", {"post_id": post_id})
        self.s.delete("posts", {"id": post_id})

    # ---------- Вкладення ----------
    def add_attachment(self, post_id: str, file_name: str, content_type: str, data: bytes, storage, max_mb: int) -> Row:
        post = self.a.get_post(post_id)
        self.a.require_post_owner(post)
        name = re.sub(r"[^\w.\- ]", "_", file_name)[:120] or "file"
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        fmt = ALLOWED_TYPES.get(content_type)
        if not fmt or ext not in EXT:
            raise HTTPException(415, "Непідтримуваний тип файлу. Дозволено: PDF, DOCX, PPTX, зображення (PNG, JPG, WEBP, GIF), ZIP")
        if len(data) == 0:
            raise HTTPException(400, "Файл порожній")
        if len(data) > max_mb * 1024 * 1024:
            raise HTTPException(413, f"Файл завеликий. Максимум {max_mb} МБ")
        if not any(data.startswith(sig) for sig in MAGIC[fmt]):
            raise HTTPException(415, "Вміст файлу не відповідає його формату")
        if self.s.count("attachments", [("post_id", "eq", post_id)]) >= 10:
            raise HTTPException(400, "Не більше 10 вкладень на допис")
        path = f"{post['university_id']}/{post_id}/{uuid.uuid4().hex}-{name}"
        storage.put(path, data, content_type)
        row = self.s.insert("attachments", {"post_id": post_id, "university_id": post["university_id"],
                                            "uploader_id": self.a.user_id, "storage_path": path, "file_name": name,
                                            "mime_type": content_type, "size_bytes": len(data)})
        return self._att_out(row)

    def attachment_link(self, attachment_id: str, storage) -> Row:
        att = self.s.get("attachments", id=attachment_id)
        if not att:
            raise HTTPException(404, "Файл не знайдено")
        self.a.get_post(att["post_id"])  # перевірка доступу до допису
        return {"url": storage.signed_url(att["storage_path"], att["file_name"]), "expires_in": 120}

    def delete_attachment(self, attachment_id: str, storage) -> None:
        att = self.s.get("attachments", id=attachment_id)
        if not att or att["uploader_id"] != self.a.user_id:
            raise HTTPException(404, "Файл не знайдено")
        storage.remove(att["storage_path"])
        self.s.delete("attachments", {"id": attachment_id})

    # ---------- Реакції та закладки ----------
    def toggle_useful(self, target_type: str, target_id: str) -> Row:
        table = "posts" if target_type == "post" else "comments"
        if target_type == "post":
            target = self.a.get_post(target_id)
        else:
            target = self.s.get("comments", id=target_id)
            if not target:
                raise HTTPException(404, "Не знайдено")
            self.a.get_post(target["post_id"])
        key = {"user_id": self.a.user_id, "target_type": target_type, "target_id": target_id, "kind": "useful"}
        exists = self.s.select("reactions", [(k, "eq", v) for k, v in key.items()], limit=1)
        if exists:
            self.s.delete("reactions", key)
            n = max(0, target["useful_count"] - 1)
        else:
            self.s.insert("reactions", key)
            n = target["useful_count"] + 1
        self.s.update(table, {"id": target_id}, {"useful_count": n})
        return {"active": not exists, "useful_count": n}

    def toggle_bookmark(self, post_id: str) -> Row:
        self.a.get_post(post_id)
        key = {"user_id": self.a.user_id, "post_id": post_id}
        if self.s.select("bookmarks", [(k, "eq", v) for k, v in key.items()], limit=1):
            self.s.delete("bookmarks", key)
            return {"saved": False}
        self.s.insert("bookmarks", key)
        return {"saved": True}

    # ---------- Коментарі та відповіді ----------
    def comments(self, post_id: str) -> list[Row]:
        post = self.a.get_post(post_id)
        rows = self.s.select("comments", [("post_id", "eq", post_id)], order="created_at")
        staff = self.a.is_staff(post["university_id"])
        rows = [r for r in rows if not r.get("is_hidden") or staff]
        authors = self._profiles({r["author_id"] for r in rows})
        liked = {r["target_id"] for r in self.s.select("reactions", [("user_id", "eq", self.a.user_id), ("target_type", "eq", "comment"),
                                                                     ("target_id", "in", [c["id"] for c in rows])])} if rows else set()
        return [{**{k: r[k] for k in ("id", "post_id", "parent_id", "body", "is_accepted", "useful_count", "created_at", "is_hidden")},
                 "author": authors.get(r["author_id"], {"id": r["author_id"], "display_name": "Користувач"}),
                 "is_mine": r["author_id"] == self.a.user_id, "liked": r["id"] in liked} for r in rows]

    def add_comment(self, post_id: str, data: CommentCreate) -> Row:
        post = self.a.get_post(post_id)
        if data.parent_id:
            parent = self.s.get("comments", id=data.parent_id)
            if not parent or parent["post_id"] != post_id:
                raise HTTPException(400, "Невірний батьківський коментар")
        row = self.s.insert("comments", {"post_id": post_id, "university_id": post["university_id"], "author_id": self.a.user_id,
                                         "parent_id": data.parent_id, "body": data.body, "is_accepted": False,
                                         "useful_count": 0, "is_hidden": False, "created_at": _now()})
        self.s.update("posts", {"id": post_id}, {"comment_count": post["comment_count"] + 1})
        if post["author_id"] != self.a.user_id:
            me = self.a.profile.get("display_name", "Хтось")
            notify(self.s, post["author_id"], post["university_id"], "comment",
                   f"{me} відповів(ла) на «{post['title'][:80]}»", data.body[:160], f"/p/{post_id}")
        return next(c for c in self.comments(post_id) if c["id"] == row["id"])

    def delete_comment(self, comment_id: str) -> None:
        c = self.s.get("comments", id=comment_id)
        if not c:
            raise HTTPException(404, "Не знайдено")
        post = self.a.get_post(c["post_id"])
        if c["author_id"] != self.a.user_id and not self.a.is_staff(post["university_id"]):
            raise HTTPException(403, "Недостатньо прав")
        self.s.delete("comments", {"id": comment_id})
        upd = {"comment_count": max(0, post["comment_count"] - 1)}
        if post.get("accepted_comment_id") == comment_id:
            upd |= {"accepted_comment_id": None, "status": "open"}
        self.s.update("posts", {"id": post["id"]}, upd)

    def accept(self, comment_id: str) -> Row:
        c = self.s.get("comments", id=comment_id)
        if not c:
            raise HTTPException(404, "Не знайдено")
        post = self.a.get_post(c["post_id"])
        self.a.require_post_owner(post)
        if post["type"] != "question":
            raise HTTPException(400, "Прийняти відповідь можна лише в запитанні")
        if post.get("accepted_comment_id"):
            self.s.update("comments", {"id": post["accepted_comment_id"]}, {"is_accepted": False})
        self.s.update("comments", {"id": comment_id}, {"is_accepted": True})
        self.s.update("posts", {"id": post["id"]}, {"accepted_comment_id": comment_id, "status": "solved", "updated_at": _now()})
        if c["author_id"] != self.a.user_id:
            notify(self.s, c["author_id"], post["university_id"], "answer_accepted",
                   f"Вашу відповідь прийнято: «{post['title'][:80]}»", "", f"/p/{post['id']}")
        return self.get(post["id"])

    def reopen(self, post_id: str) -> Row:
        post = self.a.get_post(post_id)
        self.a.require_post_owner(post)
        if post["type"] != "question":
            raise HTTPException(400, "Це не запитання")
        if post.get("accepted_comment_id"):
            self.s.update("comments", {"id": post["accepted_comment_id"]}, {"is_accepted": False})
        self.s.update("posts", {"id": post_id}, {"accepted_comment_id": None, "status": "open", "updated_at": _now()})
        return self.get(post_id)

    # ---------- Скарги ----------
    def report(self, university_id: str, data: ReportCreate) -> Row:
        self.a.require_member(university_id)
        if data.target_type == "post":
            target = self.a.get_post(data.target_id)
        else:
            target = self.s.get("comments", id=data.target_id)
            if not target:
                raise HTTPException(404, "Не знайдено")
            self.a.get_post(target["post_id"])
        self.a.require_same_university(university_id, target)
        return self.s.insert("reports", {"university_id": university_id, "reporter_id": self.a.user_id,
                                         "target_type": data.target_type, "target_id": data.target_id,
                                         "reason": data.reason, "status": "open", "resolved_by": None})
