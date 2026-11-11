"""Store поверх Supabase PostgREST (service-role ключ, лише на сервері).

Права доступу перевіряють сервіси; RLS у базі — другий рубіж для прямих запитів.
"""
from __future__ import annotations

from typing import Any, Iterable

from .store import Filter, Row


def _escape(text: str) -> str:
    # Символи, що мають значення у фільтрі or=(...) PostgREST
    return "".join(ch for ch in str(text) if ch not in ",()*%\\")


class SupabaseStore:
    def __init__(self, url: str, service_key: str) -> None:
        from supabase import create_client

        self.client = create_client(url, service_key)

    def _apply(self, q, filters: Iterable[Filter]):
        for col, op, val in filters:
            if op == "eq":
                q = q.eq(col, val)
            elif op == "neq":
                q = q.neq(col, val)
            elif op == "in":
                q = q.in_(col, list(val) or ["00000000-0000-0000-0000-000000000000"])
            elif op == "gte":
                q = q.gte(col, val)
            elif op == "lte":
                q = q.lte(col, val)
            elif op == "is_null":
                q = q.is_(col, "null") if val else q.not_.is_(col, "null")
            elif op == "search":
                cols, text = val
                t = _escape(text)
                q = q.or_(",".join(f"{c}.ilike.*{t}*" for c in cols))
        return q

    def select(self, table, filters=(), *, order=None, desc=False, limit=None, offset=0):
        q = self._apply(self.client.table(table).select("*"), filters)
        if order:
            q = q.order(order, desc=desc)
        if limit is not None:
            q = q.range(offset, offset + limit - 1)
        return q.execute().data or []

    def get(self, table, **eq):
        rows = self.select(table, [(k, "eq", v) for k, v in eq.items()], limit=1)
        return rows[0] if rows else None

    def insert(self, table, row):
        return self.client.table(table).insert(row).execute().data[0]

    def upsert(self, table, row, on_conflict):
        return self.client.table(table).upsert(row, on_conflict=on_conflict).execute().data[0]

    def update(self, table, eq, values):
        q = self.client.table(table).update(values)
        for k, v in eq.items():
            q = q.eq(k, v)
        return q.execute().data or []

    def delete(self, table, eq):
        q = self.client.table(table).delete()
        for k, v in eq.items():
            q = q.eq(k, v)
        return len(q.execute().data or [])

    def count(self, table, filters=()):
        q = self._apply(self.client.table(table).select("*", count="exact", head=True), filters)
        return q.execute().count or 0


__all__ = ["SupabaseStore", "Any"]
