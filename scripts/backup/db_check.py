"""Перевірка бекапу бази: кількість рядків до дампу та після відновлення.

  python scripts/backup/db_check.py counts  <db_url> <out.json>    # скільки рядків у кожній таблиці (до дампу)
  python scripts/backup/db_check.py verify  <db_url> <counts.json> # відновлена копія збігається з джерелом

Таблиці беремо зі схем public і auth (auth.users — облікові записи). Під час дампу на живому сайті можуть
з'явитися нові рядки, тому дозволено невелике розходження (до 1 % або 5 рядків). Порожня таблиця, яка
в джерелі мала дані, або гроші, що розійшлися з журналом, — провал перевірки.
"""
from __future__ import annotations

import json
import sys

import psycopg

SCHEMAS = ("public", "auth")
# без цих таблиць відновлення не має сенсу — вони обов'язково мають бути у копії
REQUIRED = ("public.profiles", "public.universities", "public.payments", "public.credit_ledger", "auth.users")


def table_counts(url: str) -> dict[str, int]:
    with psycopg.connect(url, connect_timeout=20) as c:
        tables = c.execute(
            "select table_schema || '.' || table_name from information_schema.tables "
            "where table_type = 'BASE TABLE' and table_schema = any(%s) order by 1", (list(SCHEMAS),)).fetchall()
        out = {}
        for (t,) in tables:
            schema, name = t.split(".", 1)
            out[t] = c.execute(f'select count(*) from "{schema}"."{name}"').fetchone()[0]
        return out


def verify(url: str, expected: dict[str, int]) -> list[str]:
    got = table_counts(url)
    problems = []
    for t in REQUIRED:
        if t in expected and t not in got:
            problems.append(f"{t}: таблиці немає у відновленій копії")
    for t, n in expected.items():
        m = got.get(t)
        if m is None:
            problems.append(f"{t}: таблиці немає у відновленій копії")
        elif n > 0 and m == 0:
            problems.append(f"{t}: у джерелі {n} рядків, у копії — 0")
        elif abs(m - n) > max(5, n // 100):
            problems.append(f"{t}: у джерелі {n} рядків, у копії {m}")
    # гроші: кеш балансу має збігатися з журналом і у відновленій копії
    with psycopg.connect(url) as c:
        has_view = c.execute("select to_regclass('public.billing_reconciliation') is not null").fetchone()[0]
        if has_view:
            drift = c.execute("select count(*) from public.billing_reconciliation").fetchone()[0]
            if drift:
                problems.append(f"billing_reconciliation: {drift} розбіжностей балансу з журналом")
    return problems


def main() -> int:
    mode, url, path = sys.argv[1], sys.argv[2], sys.argv[3]
    if mode == "counts":
        counts = table_counts(url)
        json.dump(counts, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"таблиць: {len(counts)}, рядків: {sum(counts.values())}")
        return 0
    expected = json.load(open(path, encoding="utf-8"))
    problems = verify(url, expected)
    for p in problems:
        print(f"FAIL {p}")
    print(f"перевірено таблиць: {len(expected)}, проблем: {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
