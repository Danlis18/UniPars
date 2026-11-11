"""Мінімальний інтерфейс доступу до таблиць.

Сервіси знають лише про цей інтерфейс; конкретна реалізація — DemoStore
(пам'ять) або SupabaseStore (PostgREST). Фільтри — список кортежів
(колонка, оператор, значення), оператори: eq, neq, in, gte, lte, is_null, search.
`search` приймає значення (колонки, текст) і шукає без урахування регістру
в будь-якій із колонок.
"""
from __future__ import annotations

from typing import Any, Iterable, Protocol

Filter = tuple[str, str, Any]
Row = dict[str, Any]


class Store(Protocol):
    def select(
        self,
        table: str,
        filters: Iterable[Filter] = (),
        *,
        order: str | None = None,
        desc: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Row]: ...

    def get(self, table: str, **eq: Any) -> Row | None: ...

    def insert(self, table: str, row: Row) -> Row: ...

    def upsert(self, table: str, row: Row, on_conflict: str) -> Row: ...

    def update(self, table: str, eq: dict[str, Any], values: Row) -> list[Row]: ...

    def delete(self, table: str, eq: dict[str, Any]) -> int: ...

    def count(self, table: str, filters: Iterable[Filter] = ()) -> int: ...


def eq(**kw: Any) -> list[Filter]:
    return [(k, "eq", v) for k, v in kw.items()]
