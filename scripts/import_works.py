"""Масовий імпорт виконаних робіт у UniPars (продакшн, Supabase).

Вхід — JSON-маніфест:
{
  "university_slug": "lnu",
  "author_email": "student@gmail.com",
  "items": [
    {"subject_slug": "osnovy-prohramuvannia", "kind": "lab", "number": 1, "title": "Тема роботи",
     "file": "C:/шлях/lab-1.pdf", "role": "example", "status": "approved", "anonymous": false, "comment": ""},
    {"subject_slug": "...", "kind": "practical", "number": 1, "title": "...", "file": "...", "role": "condition"}
  ]
}
role: example — приклад виконання (подання від імені автора), condition — файл умови завдання.
status: approved — одразу опубліковано, pending — лишається в черзі модерації.

Запуск (ключі — у backend/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
  python scripts/import_works.py manifest.json            # лише план, нічого не змінює
  python scripts/import_works.py manifest.json --apply    # імпорт

Повторний запуск безпечний: наявні завдання, подання й файли умов (той самий файл до того самого завдання) пропускаються.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

KINDS = {"lab": "Лабораторна робота", "practical": "Практична робота", "module": "Модульна контрольна", "exam": "Екзамен"}
MIME = {".pdf": "application/pdf", ".zip": "application/zip", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def load_env() -> None:
    env = ROOT / "backend" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--apply", action="store_true", help="виконати імпорт (без прапорця — лише план)")
    args = ap.parse_args()
    load_env()
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Немає SUPABASE_URL або SUPABASE_SERVICE_ROLE_KEY у backend/.env")
        return 2

    from supabase import create_client  # noqa: E402

    from app.core.config import _supabase_base  # noqa: E402
    from app.services.posts import storage_key, validate_file  # noqa: E402

    m = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    sb = create_client(_supabase_base(url), key)
    db = lambda t: sb.table(t)  # noqa: E731
    bucket = sb.storage.from_(os.environ.get("STORAGE_BUCKET", "attachments"))

    uni = (db("universities").select("id,name").eq("slug", m["university_slug"]).execute().data or [None])[0]
    if not uni:
        print(f"Університет {m['university_slug']} не знайдено")
        return 2
    author = None
    page = 1
    while author is None:
        users = sb.auth.admin.list_users(page=page, per_page=1000)
        if not users:
            break
        author = next((u for u in users if (u.email or "").lower() == m["author_email"].lower()), None)
        page += 1
    if not author:
        print(f"Акаунт {m['author_email']} не знайдено")
        return 2
    profile = db("profiles").select("display_name").eq("id", author.id).execute().data[0]
    member = db("university_memberships").select("role").eq("user_id", author.id).eq("university_id", uni["id"]).execute().data
    print(f"Університет: {uni['name']}\nАвтор: {profile['display_name']} ({'учасник, роль ' + member[0]['role'] if member else 'НЕ учасник університету!'})")
    if not member:
        return 2

    subjects: dict[str, dict] = {}
    plan, problems = [], []
    for it in m["items"]:
        f = Path(it["file"])
        if it["subject_slug"] not in subjects:
            rows = db("subjects").select("id,name,slug").eq("university_id", uni["id"]).eq("slug", it["subject_slug"]).execute().data
            subjects[it["subject_slug"]] = rows[0] if rows else None
        subj = subjects[it["subject_slug"]]
        if not subj:
            problems.append(f"Предмет {it['subject_slug']} не знайдено")
            continue
        if not f.is_file():
            problems.append(f"Файл не знайдено: {f}")
            continue
        data = f.read_bytes()
        mime = MIME.get(f.suffix.lower()) or mimetypes.guess_type(f.name)[0] or ""
        try:
            name, _ = validate_file(f.name, mime, data, 25)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{f.name}: {getattr(e, 'detail', e)}")
            continue
        plan.append((it, subj, name, mime, data))

    print(f"\nПлан: {len(plan)} файлів" + (f", проблем: {len(problems)}" if problems else ""))
    for it, subj, name, _mime, data in plan:
        what = "умова" if it.get("role") == "condition" else ("опублікувати" if it.get("status", "approved") == "approved" else "на модерацію")
        anon = ", анонімно" if it.get("anonymous") else ""
        print(f"  {subj['name'][:42]:42} | {KINDS[it['kind']][:3]}. №{it['number']:<2} {it['title'][:48]:48} | {name} ({len(data) // 1024} КБ) → {what}{anon}")
    for p in problems:
        print("  ! " + p)
    if not args.apply:
        print("\nЦе лише план. Для імпорту додайте --apply.")
        return 1 if problems else 0

    created_tasks = created_subs = created_files = skipped = 0
    for it, subj, name, mime, data in plan:
        default_title = f"{KINDS[it['kind']]} №{it['number']}"
        rows = db("tasks").select("*").eq("subject_id", subj["id"]).eq("kind", it["kind"]).eq("number", it["number"]).execute().data
        if rows:
            task = rows[0]
            if task["title"] == default_title and it["title"] and it["title"] != default_title:
                db("tasks").update({"title": it["title"], "updated_at": now()}).eq("id", task["id"]).execute()
        else:
            task = db("tasks").insert({"university_id": uni["id"], "subject_id": subj["id"], "kind": it["kind"],
                                       "number": it["number"], "title": it["title"] or default_title,
                                       "description": it.get("description", ""), "created_by": author.id}).execute().data[0]
            created_tasks += 1
        if it.get("role") == "condition":
            if db("task_files").select("id").eq("task_id", task["id"]).eq("file_name", name).execute().data:
                skipped += 1
                continue
            path = storage_key(f"{uni['id']}/tasks/{task['id']}", name)
            bucket.upload(path, data, {"content-type": mime, "upsert": "false"})
            db("task_files").insert({"task_id": task["id"], "university_id": uni["id"], "uploader_id": author.id,
                                     "storage_path": path, "file_name": name, "mime_type": mime, "size_bytes": len(data)}).execute()
            created_files += 1
            continue
        if db("submissions").select("id").eq("task_id", task["id"]).eq("author_id", author.id).eq("file_name", name).execute().data:
            skipped += 1
            continue
        path = storage_key(f"{uni['id']}/submissions/{task['id']}", name)
        bucket.upload(path, data, {"content-type": mime, "upsert": "false"})
        approved = it.get("status", "approved") == "approved"
        row = {"task_id": task["id"], "university_id": uni["id"], "author_id": author.id, "comment": it.get("comment", ""),
               "status": "approved" if approved else "pending", "storage_path": path, "file_name": name, "mime_type": mime,
               "size_bytes": len(data)}
        if approved:
            row.update({"published_at": now(), "reviewed_by": author.id, "reviewed_at": now()})
        if it.get("anonymous"):
            row["is_anonymous"] = True
        db("submissions").insert(row).execute()
        created_subs += 1
    print(f"\nГотово: завдань створено {created_tasks}, робіт додано {created_subs}, файлів умов {created_files}, пропущено (вже були) {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
