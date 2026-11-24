"""Відновлення файлів Storage з теки, створеної storage_backup.py.

  python scripts/backup/storage_restore.py <backup_dir>

Змінні SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY — ЦІЛЬОВОГО проєкту (новий або той самий).
Файли, які вже існують, не перезаписуються (безпечно запускати повторно).
"""
from __future__ import annotations

import json
import mimetypes
import sys
from pathlib import Path

from storage_backup import client


def main() -> int:
    src = Path(sys.argv[1])
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    done = skipped = 0
    with client() as c:
        for bucket, files in manifest.items():
            for f in files:
                data = (src / bucket / f["path"]).read_bytes()
                ctype = mimetypes.guess_type(f["path"])[0] or "application/octet-stream"
                r = c.post(f"/object/{bucket}/{f['path']}", content=data, headers={"Content-Type": ctype, "x-upsert": "false"})
                if r.status_code in (200, 201):
                    done += 1
                elif r.status_code in (400, 409) and "exists" in r.text.lower():
                    skipped += 1
                else:
                    print(f"FAIL {bucket}/{f['path']}: {r.status_code} {r.text[:200]}")
                    return 1
    print(f"відновлено: {done}, уже були: {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
