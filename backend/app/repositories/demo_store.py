"""In-memory реалізація Store для демо-режиму і тестів."""
from __future__ import annotations

import copy
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from .store import Filter, Row

# Таблиці без колонки id (складений PK)
_NO_ID = {
    "university_memberships", "subject_programs", "subject_subscriptions",
    "material_details", "question_details", "reactions", "bookmarks", "follows",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _match(row: Row, filters: Iterable[Filter]) -> bool:
    for col, op, val in filters:
        v = row.get(col)
        if op == "eq" and v != val:
            return False
        if op == "neq" and v == val:
            return False
        if op == "in" and v not in val:
            return False
        if op == "gte" and (v is None or v < val):
            return False
        if op == "lte" and (v is None or v > val):
            return False
        if op == "is_null" and ((v is None) != bool(val)):
            return False
        if op == "search":
            cols, text = val
            t = str(text).lower()
            if not any(t in str(row.get(c) or "").lower() for c in cols):
                return False
    return True


class DemoStore:
    def __init__(self) -> None:
        self._t: dict[str, list[Row]] = {}
        self._lock = threading.RLock()

    def _table(self, name: str) -> list[Row]:
        return self._t.setdefault(name, [])

    def select(self, table, filters=(), *, order=None, desc=False, limit=None, offset=0):
        filters = list(filters)
        with self._lock:
            rows = [r for r in self._table(table) if _match(r, filters)]
            if order:
                rows.sort(key=lambda r: (r.get(order) is None, r.get(order)), reverse=desc)
            rows = rows[offset: offset + limit if limit is not None else None]
            return copy.deepcopy(rows)

    def get(self, table, **eq):
        rows = self.select(table, [(k, "eq", v) for k, v in eq.items()], limit=1)
        return rows[0] if rows else None

    def insert(self, table, row):
        row = dict(row)
        if table not in _NO_ID:
            row.setdefault("id", str(uuid.uuid4()))
        row.setdefault("created_at", _now())
        with self._lock:
            self._table(table).append(row)
        return copy.deepcopy(row)

    def upsert(self, table, row, on_conflict):
        keys = [k.strip() for k in on_conflict.split(",")]
        with self._lock:
            for r in self._table(table):
                if all(r.get(k) == row.get(k) for k in keys):
                    r.update(row)
                    return copy.deepcopy(r)
        return self.insert(table, row)

    def update(self, table, eq, values):
        out = []
        with self._lock:
            for r in self._table(table):
                if all(r.get(k) == v for k, v in eq.items()):
                    r.update(values)
                    out.append(copy.deepcopy(r))
        return out

    def delete(self, table, eq):
        with self._lock:
            rows = self._table(table)
            keep = [r for r in rows if not all(r.get(k) == v for k, v in eq.items())]
            n = len(rows) - len(keep)
            self._t[table] = keep
            return n

    def count(self, table, filters=()):
        return len(self.select(table, filters))

    # Для тестів / сидування
    def bulk(self, table: str, rows: list[Row]) -> None:
        for r in rows:
            self.insert(table, r)

    def raw(self, table: str) -> list[Row]:
        return self._table(table)


_instance: DemoStore | None = None


def get_demo_store() -> DemoStore:
    global _instance
    if _instance is None:
        from .demo_seed import seed

        _instance = DemoStore()
        seed(_instance)
    return _instance


def reset_demo_store() -> DemoStore:
    global _instance
    _instance = None
    return get_demo_store()


__all__ = ["DemoStore", "get_demo_store", "reset_demo_store", "Any"]
