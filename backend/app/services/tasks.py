"""Навчальний посібник: завдання предметів, файли умов, подання студентів і модерація.

Права (дзеркало RLS у міграції 20261119000010):
- завдання й файли умов бачать учасники університету, створюють — модератори й адміністратори;
- опубліковані приклади бачать учасники; подання на розгляді або відхилені — лише автор і модерація;
- статус змінює лише модерація; повторне схвалення нічого не дублює.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.repositories.store import Row, Store
from app.schemas.content import TaskBulkCreate, TaskCreate, TaskUpdate
from app.services.access import Access
from app.services.notifications import notify
from app.services.posts import file_out, path_in_use, validate_file

KINDS = {"lab": "Лабораторна робота", "practical": "Практична робота", "module": "Модульна контрольна", "exam": "Екзамен"}
STATUS_LABEL = {"pending": "На розгляді", "approved": "Опубліковано", "rejected": "Відхилено"}
ANONYMOUS = {"id": None, "display_name": "Анонімний студент", "avatar_url": None}
MAX_PENDING_PER_TASK = 3
MAX_SUBMISSIONS_PER_HOUR = 10


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_deadline(v: str | None) -> str | None:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(400, "Некоректна дата дедлайну") from e
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


class TaskService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    # ---------- Допоміжне ----------
    def _subject(self, university_id: str, key: str) -> Row:
        self.a.require_member(university_id)
        row = self.s.get("subjects", id=key) if len(key) == 36 else None
        row = row or self.s.get("subjects", university_id=university_id, slug=key)
        if not row or row["university_id"] != university_id:
            raise HTTPException(404, "Предмет не знайдено")
        return row

    def _task(self, task_id: str) -> Row:
        t = self.s.get("tasks", id=task_id)
        if not t:
            raise HTTPException(404, "Завдання не знайдено")
        self.a.require_member(t["university_id"])
        return t

    def _require_staff(self, university_id: str) -> None:
        if not self.a.is_staff(university_id):
            raise HTTPException(403, "Лише модератори та адміністратори")

    def _people(self, ids: set[str]) -> dict[str, Row]:
        if not ids:
            return {}
        return {r["id"]: {"id": r["id"], "display_name": r["display_name"], "avatar_url": r.get("avatar_url")}
                for r in self.s.select("profiles", [("id", "in", list(ids))])}

    @staticmethod
    def _task_brief(t: Row) -> Row:
        return {"id": t["id"], "kind": t["kind"], "number": t["number"], "title": t["title"],
                "description": t.get("description", ""), "deadline_at": t.get("deadline_at"), "subject_id": t["subject_id"]}

    def _sub_out(self, r: Row, people: dict[str, Row], tasks: dict[str, Row] | None = None,
                 subjects: dict[str, Row] | None = None, private: bool = False) -> Row:
        anonymous = bool(r.get("is_anonymous"))
        mine = r["author_id"] == self.a.user_id
        # Анонімну роботу підписуємо без імені для всіх, крім автора й модерації
        hide = anonymous and not mine and not self.a.is_staff(r["university_id"])
        author = ANONYMOUS if hide else people.get(r["author_id"], {"id": r["author_id"], "display_name": "Користувач"})
        out = {**file_out(r), "id": r["id"], "task_id": r["task_id"], "status": r["status"],
               "status_label": STATUS_LABEL[r["status"]], "created_at": r["created_at"], "published_at": r.get("published_at"),
               "download_count": r.get("download_count", 0), "author": author, "is_anonymous": anonymous,
               "is_mine": mine}
        if private:  # коментар для модератора й причина відхилення — лише автору й модерації
            out["comment"] = r.get("comment", "")
            out["review_note"] = r.get("review_note")
            out["reviewed_at"] = r.get("reviewed_at")
        if tasks is not None:
            t = tasks.get(r["task_id"])
            out["task"] = self._task_brief(t) if t else None
            if t and subjects is not None:
                sj = subjects.get(t["subject_id"], {})
                out["subject"] = {"id": sj.get("id"), "name": sj.get("name"), "slug": sj.get("slug")}
        return out

    def _can_see_submission(self, r: Row) -> bool:
        if r["author_id"] == self.a.user_id or self.a.is_staff(r["university_id"]):
            return True
        return r["status"] == "approved" and bool(self.a.membership(r["university_id"]) or self.a.is_platform_admin)

    # ---------- Перегляд ----------
    def list_tasks(self, university_id: str, subject_key: str, kind: str | None = None) -> Row:
        subj = self._subject(university_id, subject_key)
        f = [("subject_id", "eq", subj["id"])]
        if kind:
            f.append(("kind", "eq", kind))
        tasks = self.s.select("tasks", f)
        tasks.sort(key=lambda t: (list(KINDS).index(t["kind"]), t["number"]))
        ids = [t["id"] for t in tasks]
        approved: dict[str, int] = {}
        mine: dict[str, Row] = {}
        files: dict[str, int] = {}
        if ids:
            for r in self.s.select("submissions", [("task_id", "in", ids), ("status", "eq", "approved")]):
                approved[r["task_id"]] = approved.get(r["task_id"], 0) + 1
            for r in self.s.select("submissions", [("task_id", "in", ids), ("author_id", "eq", self.a.user_id)], order="created_at"):
                mine[r["task_id"]] = r  # останнє подання користувача
            for r in self.s.select("task_files", [("task_id", "in", ids)]):
                files[r["task_id"]] = files.get(r["task_id"], 0) + 1
        questions: dict[str, int] = {}
        if ids:
            for p in self.s.select("posts", [("task_id", "in", ids), ("type", "eq", "question")]):
                if self.a.can_view_post(p):
                    questions[p["task_id"]] = questions.get(p["task_id"], 0) + 1
        counts = {k: 0 for k in KINDS}
        for t in self.s.select("tasks", [("subject_id", "eq", subj["id"])]):
            counts[t["kind"]] += 1
        items = [{**self._task_brief(t), "examples": approved.get(t["id"], 0), "files": files.get(t["id"], 0),
                  "questions": questions.get(t["id"], 0),
                  "my_status": mine[t["id"]]["status"] if t["id"] in mine else None} for t in tasks]
        return {"subject": {"id": subj["id"], "name": subj["name"], "slug": subj["slug"]}, "items": items, "counts": counts,
                "can_manage": self.a.is_staff(university_id)}

    def get_task(self, task_id: str) -> Row:
        t = self._task(task_id)
        subj = self.s.get("subjects", id=t["subject_id"]) or {}
        files = [file_out(r) for r in self.s.select("task_files", [("task_id", "eq", task_id)], order="created_at")]
        examples = self.s.select("submissions", [("task_id", "eq", task_id), ("status", "eq", "approved")], order="published_at", desc=True)
        mine = self.s.select("submissions", [("task_id", "eq", task_id), ("author_id", "eq", self.a.user_id)], order="created_at", desc=True)
        people = self._people({r["author_id"] for r in examples + mine})
        siblings = self.s.select("tasks", [("subject_id", "eq", t["subject_id"]), ("kind", "eq", t["kind"])], order="number")
        idx = next((i for i, x in enumerate(siblings) if x["id"] == task_id), 0)
        nav = {"prev": self._task_brief(siblings[idx - 1]) if idx > 0 else None,
               "next": self._task_brief(siblings[idx + 1]) if idx + 1 < len(siblings) else None}
        return {
            **self._task_brief(t),
            "kind_label": KINDS[t["kind"]],
            "subject": {"id": subj.get("id"), "name": subj.get("name"), "slug": subj.get("slug")},
            "files": files,
            "examples": [self._sub_out(r, people) for r in examples],
            "my_submissions": [self._sub_out(r, people, private=True) for r in mine],
            "can_manage": self.a.is_staff(t["university_id"]),
            **nav,
        }

    # ---------- Керування завданнями (модерація) ----------
    def create_task(self, university_id: str, data: TaskCreate) -> Row:
        self._require_staff(university_id)
        subj = self._subject(university_id, data.subject_id)
        if self.s.select("tasks", [("subject_id", "eq", subj["id"]), ("kind", "eq", data.kind), ("number", "eq", data.number)], limit=1):
            raise HTTPException(409, f"{KINDS[data.kind]} №{data.number} уже існує")
        row = self.s.insert("tasks", {
            "id": str(uuid.uuid4()), "university_id": university_id, "subject_id": subj["id"], "kind": data.kind,
            "number": data.number, "title": data.title.strip(), "description": data.description,
            "deadline_at": _parse_deadline(data.deadline_at), "created_by": self.a.user_id,
            "created_at": _now(), "updated_at": _now(),
        })
        return self.get_task(row["id"])

    def bulk_create(self, university_id: str, data: TaskBulkCreate) -> Row:
        """Швидко створити N завдань («Лабораторна робота №1…N»), пропускаючи вже наявні номери."""
        self._require_staff(university_id)
        subj = self._subject(university_id, data.subject_id)
        existing = {t["number"] for t in self.s.select("tasks", [("subject_id", "eq", subj["id"]), ("kind", "eq", data.kind)])}
        created = 0
        for n in range(1, data.count + 1):
            if n in existing:
                continue
            self.s.insert("tasks", {
                "id": str(uuid.uuid4()), "university_id": university_id, "subject_id": subj["id"], "kind": data.kind,
                "number": n, "title": f"{KINDS[data.kind]} №{n}", "description": "", "deadline_at": None,
                "created_by": self.a.user_id, "created_at": _now(), "updated_at": _now(),
            })
            created += 1
        return {"created": created}

    def update_task(self, task_id: str, data: TaskUpdate) -> Row:
        t = self._task(task_id)
        self._require_staff(t["university_id"])
        values = data.model_dump(exclude_unset=True)
        if "deadline_at" in values:
            values["deadline_at"] = _parse_deadline(values["deadline_at"])
        if "number" in values and values["number"] != t["number"]:
            if self.s.select("tasks", [("subject_id", "eq", t["subject_id"]), ("kind", "eq", t["kind"]), ("number", "eq", values["number"])], limit=1):
                raise HTTPException(409, f"№{values['number']} уже зайнятий")
        if "title" in values:
            values["title"] = values["title"].strip()
        values["updated_at"] = _now()
        self.s.update("tasks", {"id": task_id}, values)
        return self.get_task(task_id)

    def delete_task(self, task_id: str, storage) -> None:
        t = self._task(task_id)
        self._require_staff(t["university_id"])
        if self.s.count("submissions", [("task_id", "eq", task_id)]):
            raise HTTPException(409, "До завдання вже є подання. Спершу перенесіть або видаліть їх.")
        for f in self.s.select("task_files", [("task_id", "eq", task_id)]):
            if not path_in_use(self.s, f["storage_path"], skip_table="task_files", skip_id=f["id"]):
                try:
                    storage.remove(f["storage_path"])
                except Exception:
                    pass
            self.s.delete("task_files", {"id": f["id"]})
        for p in self.s.select("posts", [("task_id", "eq", task_id)]):
            self.s.update("posts", {"id": p["id"]}, {"task_id": None})
        self.s.delete("tasks", {"id": task_id})

    def add_task_file(self, task_id: str, file_name: str, content_type: str, data: bytes, storage, max_mb: int) -> Row:
        t = self._task(task_id)
        self._require_staff(t["university_id"])
        name, _ = validate_file(file_name, content_type, data, max_mb)
        if self.s.count("task_files", [("task_id", "eq", task_id)]) >= 10:
            raise HTTPException(400, "Не більше 10 файлів до завдання")
        path = f"{t['university_id']}/tasks/{task_id}/{uuid.uuid4().hex}-{name}"
        storage.put(path, data, content_type)
        row = self.s.insert("task_files", {"task_id": task_id, "university_id": t["university_id"], "uploader_id": self.a.user_id,
                                           "storage_path": path, "file_name": name, "mime_type": content_type, "size_bytes": len(data)})
        return file_out(row)

    def delete_task_file(self, file_id: str, storage) -> None:
        f = self.s.get("task_files", id=file_id)
        if not f:
            raise HTTPException(404, "Файл не знайдено")
        self._require_staff(f["university_id"])
        if not path_in_use(self.s, f["storage_path"], skip_table="task_files", skip_id=f["id"]):
            storage.remove(f["storage_path"])
        self.s.delete("task_files", {"id": file_id})

    def task_file_link(self, file_id: str, storage, download: bool = False) -> Row:
        f = self.s.get("task_files", id=file_id)
        if not f:
            raise HTTPException(404, "Файл не знайдено")
        self.a.require_member(f["university_id"])
        return {"url": storage.signed_url(f["storage_path"], f["file_name"], download), "expires_in": 120}

    # ---------- Подання ----------
    def submit(self, task_id: str, file_name: str, content_type: str, data: bytes, comment: str, storage, max_mb: int,
               anonymous: bool = False) -> Row:
        t = self._task(task_id)
        comment = (comment or "").strip()
        if len(comment) > 2000:
            raise HTTPException(400, "Коментар задовгий (до 2000 символів)")
        name, _ = validate_file(file_name, content_type, data, max_mb)
        mine = self.s.select("submissions", [("author_id", "eq", self.a.user_id)])
        if sum(1 for r in mine if r["task_id"] == task_id and r["status"] == "pending") >= MAX_PENDING_PER_TASK:
            raise HTTPException(429, "У вас уже 3 подання на розгляді до цього завдання. Дочекайтеся рішення модератора.")
        hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        if sum(1 for r in mine if r["created_at"] >= hour_ago) >= MAX_SUBMISSIONS_PER_HOUR:
            raise HTTPException(429, "Забагато подань за годину. Спробуйте пізніше.")
        path = f"{t['university_id']}/submissions/{task_id}/{uuid.uuid4().hex}-{name}"
        storage.put(path, data, content_type)
        row = {
            "id": str(uuid.uuid4()), "task_id": task_id, "university_id": t["university_id"], "author_id": self.a.user_id,
            "comment": comment, "status": "pending", "review_note": None, "reviewed_by": None, "reviewed_at": None,
            "published_at": None, "storage_path": path, "file_name": name, "mime_type": content_type, "size_bytes": len(data),
            "source_attachment_id": None, "download_count": 0, "created_at": _now(), "updated_at": _now(),
        }
        if anonymous:  # колонка з міграції 12; звичайні подання працюють і без неї
            row["is_anonymous"] = True
        row = self.s.insert("submissions", row)
        return self._sub_out(row, self._people({self.a.user_id}), private=True)

    def my_submissions(self, university_id: str) -> list[Row]:
        self.a.require_member(university_id)
        rows = self.s.select("submissions", [("author_id", "eq", self.a.user_id), ("university_id", "eq", university_id)],
                             order="created_at", desc=True, limit=200)
        return self._with_context(rows, private=True)

    def _with_context(self, rows: list[Row], private: bool) -> list[Row]:
        tasks = {t["id"]: t for t in self.s.select("tasks", [("id", "in", list({r["task_id"] for r in rows}))])} if rows else {}
        subjects = {s["id"]: s for s in self.s.select("subjects", [("id", "in", list({t["subject_id"] for t in tasks.values()}))])} if tasks else {}
        people = self._people({r["author_id"] for r in rows})
        return [self._sub_out(r, people, tasks, subjects, private=private) for r in rows]

    def withdraw(self, submission_id: str, storage) -> None:
        r = self.s.get("submissions", id=submission_id)
        if not r or r["author_id"] != self.a.user_id:
            raise HTTPException(404, "Подання не знайдено")
        if r["status"] != "pending":
            raise HTTPException(400, "Відкликати можна лише подання на розгляді")
        if not path_in_use(self.s, r["storage_path"], skip_table="submissions", skip_id=r["id"]):
            try:
                storage.remove(r["storage_path"])
            except Exception:
                pass
        self.s.delete("submissions", {"id": submission_id})

    def submission_link(self, submission_id: str, storage, download: bool = False) -> Row:
        r = self.s.get("submissions", id=submission_id)
        # 404 замість 403: не розкриваємо існування чужих подань на розгляді
        if not r or not self._can_see_submission(r):
            raise HTTPException(404, "Файл не знайдено")
        if r["status"] == "approved" and r["author_id"] != self.a.user_id:
            self.s.update("submissions", {"id": submission_id}, {"download_count": (r.get("download_count") or 0) + 1})
        return {"url": storage.signed_url(r["storage_path"], r["file_name"], download), "expires_in": 120}

    # ---------- Модерація ----------
    def queue(self, university_id: str, status: str = "pending") -> list[Row]:
        self._require_staff(university_id)
        rows = self.s.select("submissions", [("university_id", "eq", university_id), ("status", "eq", status)],
                             order="created_at", desc=status != "pending", limit=200)
        return self._with_context(rows, private=True)

    def review(self, submission_id: str, action: str, note: str | None) -> Row:
        r = self.s.get("submissions", id=submission_id)
        if not r:
            raise HTTPException(404, "Подання не знайдено")
        self._require_staff(r["university_id"])
        t = self.s.get("tasks", id=r["task_id"]) or {}
        link = f"/tasks/{r['task_id']}"
        title = f"{KINDS.get(t.get('kind'), 'Завдання')} №{t.get('number', '')}"
        if action == "approve":
            if r["status"] == "approved":
                return self._with_context([r], private=True)[0]  # повторне схвалення нічого не змінює
            self.s.update("submissions", {"id": submission_id}, {
                "status": "approved", "published_at": _now(), "review_note": None,
                "reviewed_by": self.a.user_id, "reviewed_at": _now(), "updated_at": _now()})
            if r["author_id"] != self.a.user_id:
                notify(self.s, r["author_id"], r["university_id"], "submission_approved",
                       "Вашу роботу опубліковано", f"{title}: «{r['file_name']}» тепер бачать інші студенти.", link)
        else:
            note = (note or "").strip()
            if not note:
                raise HTTPException(400, "Вкажіть причину відхилення — її побачить автор")
            self.s.update("submissions", {"id": submission_id}, {
                "status": "rejected", "published_at": None, "review_note": note[:2000],
                "reviewed_by": self.a.user_id, "reviewed_at": _now(), "updated_at": _now()})
            if r["author_id"] != self.a.user_id:
                notify(self.s, r["author_id"], r["university_id"], "submission_rejected",
                       "Роботу не опубліковано", f"{title}: {note[:300]}", "/submissions")
        return self._with_context([self.s.get("submissions", id=submission_id)], private=True)[0]

    # ---------- Розподіл старих матеріалів ----------
    def unassigned(self, university_id: str) -> list[Row]:
        self._require_staff(university_id)
        linked = {r["source_attachment_id"] for r in self.s.select("submissions", [("university_id", "eq", university_id)])
                  if r.get("source_attachment_id")}
        atts = [a for a in self.s.select("attachments", [("university_id", "eq", university_id)], order="created_at", desc=True)
                if a["id"] not in linked]
        posts = {p["id"]: p for p in self.s.select("posts", [("id", "in", list({a["post_id"] for a in atts}))])} if atts else {}
        subjects = {s["id"]: s for s in self.s.select("subjects", [("id", "in", list({p["subject_id"] for p in posts.values()}))])} if posts else {}
        people = self._people({p["author_id"] for p in posts.values()})
        out = []
        for a in atts:
            p = posts.get(a["post_id"])
            if not p or p["type"] == "question":
                continue  # вкладення до питань форуму не є навчальними матеріалами
            sj = subjects.get(p["subject_id"], {})
            out.append({**file_out(a), "post": {"id": p["id"], "title": p["title"], "type": p["type"]},
                        "subject": {"id": sj.get("id"), "name": sj.get("name"), "slug": sj.get("slug")},
                        "author": people.get(p["author_id"])})
        return out

    def assign(self, attachment_id: str, task_id: str) -> Row:
        a = self.s.get("attachments", id=attachment_id)
        if not a:
            raise HTTPException(404, "Матеріал не знайдено")
        self._require_staff(a["university_id"])
        t = self._task(task_id)
        if t["university_id"] != a["university_id"]:
            raise HTTPException(400, "Завдання з іншого університету")
        existing = self.s.select("submissions", [("source_attachment_id", "eq", attachment_id)], limit=1)
        if existing:
            raise HTTPException(409, "Цей матеріал уже прив'язано до завдання")
        post = self.s.get("posts", id=a["post_id"]) or {}
        row = self.s.insert("submissions", {
            "id": str(uuid.uuid4()), "task_id": task_id, "university_id": a["university_id"],
            "author_id": post.get("author_id") or a["uploader_id"], "comment": post.get("title", "")[:2000],
            "status": "approved", "review_note": None, "reviewed_by": self.a.user_id, "reviewed_at": _now(),
            "published_at": _now(), "storage_path": a["storage_path"], "file_name": a["file_name"],
            "mime_type": a["mime_type"], "size_bytes": a["size_bytes"], "source_attachment_id": attachment_id,
            "download_count": 0, "created_at": a.get("created_at") or _now(), "updated_at": _now(),
        })
        return self._with_context([row], private=True)[0]

    # ---------- Головна ----------
    def home(self, university_id: str) -> Row:
        m = self.a.require_member(university_id)
        subs = {r["subject_id"] for r in self.s.select("subject_subscriptions", [("user_id", "eq", self.a.user_id)])}
        program = m.get("program_id")
        if not subs and program:
            subs = {r["subject_id"] for r in self.s.select("subject_programs", [("program_id", "eq", program)])}
        now = datetime.now(timezone.utc).isoformat()
        upcoming = [t for t in self.s.select("tasks", [("university_id", "eq", university_id), ("deadline_at", "gte", now)], order="deadline_at")
                    if not subs or t["subject_id"] in subs][:8]
        examples = self.s.select("submissions", [("university_id", "eq", university_id), ("status", "eq", "approved")],
                                 order="published_at", desc=True, limit=200)
        popular = any((r.get("download_count") or 0) > 0 for r in examples)
        if popular:
            examples.sort(key=lambda r: ((r.get("download_count") or 0), r.get("published_at") or ""), reverse=True)
        subjects = {s["id"]: s for s in self.s.select("subjects", [("id", "in", list({t["subject_id"] for t in upcoming}))])} if upcoming else {}
        return {
            "deadlines": [{**self._task_brief(t), "subject": {"name": subjects.get(t["subject_id"], {}).get("name"),
                                                              "slug": subjects.get(t["subject_id"], {}).get("slug")}} for t in upcoming],
            "materials": self._with_context(examples[:6], private=False),
            "materials_mode": "popular" if popular else "recent",
        }

    def published_by(self, university_id: str, author_id: str) -> list[Row]:
        self.a.require_member(university_id)
        rows = self.s.select("submissions", [("university_id", "eq", university_id), ("author_id", "eq", author_id),
                                             ("status", "eq", "approved")], order="published_at", desc=True, limit=100)
        if author_id != self.a.user_id:  # анонімні роботи не розкриваємо через профіль автора
            rows = [r for r in rows if not r.get("is_anonymous")]
        return self._with_context(rows, private=False)
