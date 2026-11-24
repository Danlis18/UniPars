"""Копія файлів із Supabase Storage (роботи студентів, аватари) у теку.

  python scripts/backup/storage_backup.py <out_dir> [bucket ...]

Потрібні змінні SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY (лише читання файлів).
Поруч із файлами пишеться manifest.json: шлях, розмір — для перевірки й відновлення
(scripts/backup/storage_restore.py завантажує файли назад з тими самими шляхами).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

DEFAULT_BUCKETS = ("attachments", "avatars")


def client() -> httpx.Client:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return httpx.Client(base_url=f"{url}/storage/v1", headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=60)


def list_files(c: httpx.Client, bucket: str, prefix: str = "") -> list[dict]:
    """Усі файли бакета рекурсивно (теки в API Storage — записи з id = null)."""
    out, offset = [], 0
    while True:
        r = c.post(f"/object/list/{bucket}", json={"prefix": prefix, "limit": 1000, "offset": offset,
                                                   "sortBy": {"column": "name", "order": "asc"}})
        r.raise_for_status()
        items = r.json()
        for it in items:
            path = f"{prefix}{it['name']}"
            if it.get("id") is None:
                out += list_files(c, bucket, f"{path}/")
            else:
                out.append({"path": path, "size": (it.get("metadata") or {}).get("size")})
        if len(items) < 1000:
            return out
        offset += 1000


def main() -> int:
    out_dir = Path(sys.argv[1])
    buckets = sys.argv[2:] or list(DEFAULT_BUCKETS)
    manifest, total = {}, 0
    with client() as c:
        for bucket in buckets:
            files = list_files(c, bucket)
            for f in files:
                r = c.get(f"/object/{bucket}/{f['path']}")
                r.raise_for_status()
                dest = out_dir / bucket / f["path"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(r.content)
                f["size"] = len(r.content)
                total += len(r.content)
            manifest[bucket] = files
            print(f"{bucket}: {len(files)} файлів")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"усього: {sum(len(v) for v in manifest.values())} файлів, {total / 1048576:.1f} МБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
