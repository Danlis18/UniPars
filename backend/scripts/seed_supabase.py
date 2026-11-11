"""Заповнює Supabase ДЕМОНСТРАЦІЙНИМ каталогом: університети, факультети,
спеціальності, групи, предмети, теми та демо-оголошення.

Дописи не створюються: вони потребують реальних користувачів Supabase Auth.

    cd backend
    python scripts/seed_supabase.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.repositories.demo_store import DemoStore  # noqa: E402
from app.repositories.demo_seed import seed  # noqa: E402

TABLES = [  # порядок важливий через зовнішні ключі
    ("universities", "id"), ("faculties", "id"), ("programs", "id"), ("study_groups", "id"),
    ("subjects", "id"), ("subject_programs", "subject_id,program_id"), ("topics", "id"),
    ("news_sources", "id"), ("news_items", "source_id,external_id"),
]


def main() -> None:
    s = get_settings()
    if not (s.supabase_url and s.supabase_service_role_key):
        sys.exit("Вкажіть SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY у backend/.env")
    from supabase import create_client

    client = create_client(s.supabase_url, s.supabase_service_role_key)
    demo = DemoStore()
    seed(demo)
    for table, conflict in TABLES:
        rows = [{k: v for k, v in r.items() if k != "created_at"} for r in demo.raw(table)]
        if rows:
            client.table(table).upsert(rows, on_conflict=conflict).execute()
            print(f"{table}: {len(rows)}")
    print("Готово. Демо-університети позначені is_demo = true.")


if __name__ == "__main__":
    main()
