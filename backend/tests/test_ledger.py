"""Баланс генерацій = сума журналу; атомарні списання, повернення й зарахування оплат.

Ті самі сценарії проганяються на двох реалізаціях функцій балансу:
- demo — DemoStore + app/repositories/demo_billing.py (завжди);
- postgres — справжні SQL-функції з міграції 20261124000014 (якщо задано TEST_DATABASE_URL, як у CI).
Кожен тест на Postgres отримує окрему чисту схему; прод ніколи не використовується.
"""
from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.repositories.demo_store import DemoStore
from app.repositories.store import RpcError

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
BILLING_SQL = MIGRATIONS / "20261121000013_billing_and_regeneration.sql"
LEDGER_SQL = MIGRATIONS / "20261124000014_billing_ledger_balance.sql"
REFUNDS_SQL = MIGRATIONS / "20261125000015_payment_refunds.sql"
WELCOME_SQL = MIGRATIONS / "20261126000016_welcome_generations.sql"
PG_URL = os.environ.get("TEST_DATABASE_URL")

# Мінімальне оточення Supabase, від якого залежать міграції оплати (ролі, auth.uid, батьківські таблиці)
PG_STUBS = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table profiles (id uuid primary key);
create table universities (id uuid primary key);
create table tasks (id uuid primary key);
create table submissions (id uuid primary key);
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- Адаптер Postgres з тим самим інтерфейсом, що й Store ----------
class PgStore:
    def __init__(self, url: str, schema: str) -> None:
        import psycopg
        from psycopg.rows import dict_row

        self.url, self.schema = url, schema
        self.conn = psycopg.connect(url, autocommit=True, row_factory=dict_row, options=f"-c search_path={schema},public")

    def fork(self) -> "PgStore":
        return PgStore(self.url, self.schema)

    @staticmethod
    def _plain(v):
        if isinstance(v, uuid.UUID):
            return str(v)
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, dict):
            return {k: PgStore._plain(x) for k, x in v.items()}
        return v

    def insert(self, table: str, row: dict) -> dict:
        cols = ", ".join(row)
        vals = ", ".join(f"%({k})s" for k in row)
        return self._plain(self.conn.execute(f"insert into {table} ({cols}) values ({vals}) returning *", row).fetchone())

    def select(self, table: str, filters=()) -> list[dict]:
        where = " and ".join(f"{c} = %({c})s" for c, _op, _v in filters) or "true"
        rows = self.conn.execute(f"select * from {table} where {where}", {c: v for c, _op, v in filters}).fetchall()
        return [self._plain(r) for r in rows]

    def rpc(self, name: str, params: dict):
        import psycopg

        args = ", ".join(f"{k} => %({k})s" for k in params)
        try:
            row = self.conn.execute(f"select {name}({args}) as r", params).fetchone()
        except psycopg.Error as e:
            # RAISE у функціях балансу (класи P0…, зокрема власні коди P0402/P0404) → RpcError, як у SupabaseStore
            if (e.sqlstate or "").startswith("P0"):
                raise RpcError(e.diag.message_primary or str(e)) from e
            raise
        return self._plain(row["r"])

    def close(self) -> None:
        self.conn.close()


class DemoAdapter(DemoStore):
    def fork(self) -> "DemoAdapter":
        return self  # одна пам'ять на всі потоки; атомарність дає блокування DemoStore

    def close(self) -> None:
        pass


def _pg_schema(apply_ledger: bool = True):
    import psycopg

    schema = f"t_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(PG_URL, autocommit=True) as c:
        c.execute(f"create schema {schema}")
        c.execute(f"set search_path = {schema}, public")
        c.execute(PG_STUBS)
        c.execute(BILLING_SQL.read_text(encoding="utf-8"))
        if apply_ledger:
            c.execute(LEDGER_SQL.read_text(encoding="utf-8"))
            c.execute(REFUNDS_SQL.read_text(encoding="utf-8"))
            c.execute(WELCOME_SQL.read_text(encoding="utf-8"))
    return schema


def _drop_schema(schema: str) -> None:
    import psycopg

    with psycopg.connect(PG_URL, autocommit=True) as c:
        c.execute(f"drop schema {schema} cascade")


BACKENDS = ["demo"] + (["postgres"] if PG_URL else [])


@pytest.fixture(params=BACKENDS)
def db(request):
    if request.param == "demo":
        yield DemoAdapter()
        return
    schema = _pg_schema()
    store = PgStore(PG_URL, schema)
    try:
        yield store
    finally:
        store.close()
        _drop_schema(schema)


# ---------- Допоміжне ----------
def user(db) -> str:
    uid = str(uuid.uuid4())
    if isinstance(db, PgStore):
        db.insert("profiles", {"id": uid})
    return uid


def payment(db, uid: str, kind: str = "single", quantity: int = 1) -> str:
    pid = str(uuid.uuid4())
    db.insert("payments", {"id": pid, "user_id": uid, "kind": kind, "quantity": quantity, "amount_kop": 4700 * quantity,
                           "currency": "UAH", "status": "created", "provider": "mock", "applied_at": None})
    return pid


def pay(db, uid: str, kind: str = "single", quantity: int = 1, credits: int = 15) -> str:
    pid = payment(db, uid, kind, quantity)
    db.rpc("billing_set_status", {"p_payment": pid, "p_status": "success", "p_reason": None, "p_sub_credits": credits})
    return pid


def balance(db, uid: str) -> dict:
    return db.rpc("billing_balance", {"p_user": uid})


def consume(db, uid: str) -> str:
    return db.rpc("billing_consume", {"p_user": uid, "p_regeneration": str(uuid.uuid4())})


def ledger(db, **eq) -> list[dict]:
    return db.select("credit_ledger", [(k, "eq", v) for k, v in eq.items()])


def assert_cache_matches_ledger(db, uid: str) -> None:
    """Лічильники-кеш дорівнюють сумі журналу — і для разових генерацій, і для кожної підписки."""
    acc = db.select("billing_accounts", [("user_id", "eq", uid)])
    credits = sum(r["delta"] for r in ledger(db, user_id=uid, pool="credits"))
    assert (acc[0]["credits"] if acc else 0) == credits
    for s in db.select("subscriptions", [("user_id", "eq", uid)]):
        assert s["credits_left"] == sum(r["delta"] for r in ledger(db, subscription_id=s["id"]))


# ---------- Сценарії ----------
def test_balance_is_sum_of_ledger(db):
    uid = user(db)
    pay(db, uid, "single", 3)
    pay(db, uid, "subscription", credits=15)
    consume(db, uid)
    b = balance(db, uid)
    assert b["credits"] == 3 and b["subscription"]["credits_left"] == 14
    assert b["credits"] == sum(r["delta"] for r in ledger(db, user_id=uid, pool="credits"))
    assert_cache_matches_ledger(db, uid)


def test_payment_applied_exactly_once(db):
    uid = user(db)
    pid = pay(db, uid, "topup", 2)
    for status in ("success", "success", "processing", "failure"):  # повтори й запізнілі webhook-и
        db.rpc("billing_set_status", {"p_payment": pid, "p_status": status, "p_reason": "x", "p_sub_credits": 15})
    p = db.select("payments", [("id", "eq", pid)])[0]
    assert p["status"] == "success" and p["applied_at"]  # успішний платіж не понижується
    assert balance(db, uid)["credits"] == 2
    assert len(ledger(db, payment_id=pid)) == 1


def test_failed_payment_credits_nothing(db):
    uid = user(db)
    pid = payment(db, uid)
    db.rpc("billing_set_status", {"p_payment": pid, "p_status": "failure", "p_reason": "declined", "p_sub_credits": 15})
    assert balance(db, uid)["credits"] == 0 and ledger(db, user_id=uid) == []


def test_unknown_payment_is_an_error(db):
    with pytest.raises(RpcError, match="payment_not_found"):
        db.rpc("billing_set_status", {"p_payment": str(uuid.uuid4()), "p_status": "success", "p_reason": None, "p_sub_credits": 15})


def test_consume_prefers_subscription_then_credits(db):
    uid = user(db)
    pay(db, uid, "single", 1)
    pay(db, uid, "subscription", credits=2)
    assert [consume(db, uid) for _ in range(3)] == ["subscription", "subscription", "credits"]
    with pytest.raises(RpcError, match="no_credits"):
        consume(db, uid)
    assert balance(db, uid)["credits"] == 0
    assert_cache_matches_ledger(db, uid)


def test_subscription_renewal_extends_and_adds_credits(db):
    uid = user(db)
    pay(db, uid, "subscription", credits=15)
    first = balance(db, uid)["subscription"]
    pay(db, uid, "subscription", credits=15)
    second = balance(db, uid)["subscription"]
    assert second["id"] == first["id"] and second["credits_left"] == 30 and second["credits_included"] == 30
    assert datetime.fromisoformat(second["period_end"]) - datetime.fromisoformat(first["period_end"]) == timedelta(days=30)


def test_expired_subscription_credits_are_not_available(db):
    uid = user(db)
    sid = str(uuid.uuid4())
    db.insert("subscriptions", {"id": sid, "user_id": uid, "period_start": (_now() - timedelta(days=40)).isoformat(),
                                "period_end": (_now() - timedelta(days=10)).isoformat(), "credits_included": 15, "credits_left": 15})
    db.insert("credit_ledger", {"user_id": uid, "delta": 15, "source": "subscription", "pool": "subscription", "subscription_id": sid})
    assert balance(db, uid)["subscription"] is None
    with pytest.raises(RpcError, match="no_credits"):
        consume(db, uid)


def test_refund_returns_to_same_pool_once(db):
    uid = user(db)
    pay(db, uid, "single", 1)
    pay(db, uid, "subscription", credits=1)
    rid = str(uuid.uuid4())
    assert db.rpc("billing_consume", {"p_user": uid, "p_regeneration": rid}) == "subscription"
    assert db.rpc("billing_consume", {"p_user": uid, "p_regeneration": rid}) == "subscription"  # повтор не списує вдруге
    assert db.rpc("billing_refund", {"p_regeneration": rid}) is True
    assert db.rpc("billing_refund", {"p_regeneration": rid}) is False
    b = balance(db, uid)
    assert b["credits"] == 1 and b["subscription"]["credits_left"] == 1
    assert db.rpc("billing_refund", {"p_regeneration": str(uuid.uuid4())}) is False  # нічого не списували
    assert_cache_matches_ledger(db, uid)


def _parallel(db, n: int, fn) -> list:
    results: list = [None] * n
    barrier = threading.Barrier(n)

    def run(i):
        s = db.fork()
        try:
            barrier.wait()
            results[i] = fn(s)
        except Exception as e:  # noqa: BLE001 — збираємо, щоб перевірити нижче
            results[i] = e
        finally:
            if s is not db:
                s.close()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_concurrent_consumes_never_overspend(db):
    uid = user(db)
    pay(db, uid, "single", 5)
    results = _parallel(db, 12, lambda s: consume(s, uid))
    ok = [r for r in results if r == "credits"]
    failed = [r for r in results if isinstance(r, RpcError) and "no_credits" in str(r)]
    assert len(ok) == 5 and len(failed) == 7, results
    assert balance(db, uid)["credits"] == 0
    assert_cache_matches_ledger(db, uid)


def test_concurrent_webhooks_credit_once(db):
    uid = user(db)
    pid = payment(db, uid, "single", 3)
    _parallel(db, 8, lambda s: s.rpc("billing_set_status", {"p_payment": pid, "p_status": "success", "p_reason": None, "p_sub_credits": 15}))
    assert balance(db, uid)["credits"] == 3
    assert len(ledger(db, payment_id=pid)) == 1


# ---------- Міграція наявних даних (лише Postgres) ----------
@pytest.mark.skipif(not PG_URL, reason="потрібен TEST_DATABASE_URL (Postgres у CI)")
def test_migration_backfills_pools_and_reconciles_caches():
    import psycopg

    schema = _pg_schema(apply_ledger=False)
    try:
        s = PgStore(PG_URL, schema)
        uid, uni, task, sub_id = (str(uuid.uuid4()) for _ in range(4))
        s.insert("profiles", {"id": uid})
        s.insert("universities", {"id": uni})
        s.insert("tasks", {"id": task})
        # стан до міграції: 2 разові (одна списана), підписка 15 → 14, кеш на 1 більший за журнал (втрачений запис)
        pid = payment(s, uid, "single", 2)
        spid = payment(s, uid, "subscription")
        s.insert("subscriptions", {"id": sub_id, "user_id": uid, "period_start": (_now() - timedelta(days=1)).isoformat(),
                                   "period_end": (_now() + timedelta(days=29)).isoformat(), "credits_included": 15,
                                   "credits_left": 14, "payment_id": spid})
        s.insert("billing_accounts", {"user_id": uid, "credits": 2})
        s.insert("credit_ledger", {"user_id": uid, "delta": 2, "source": "single", "payment_id": pid})
        s.insert("credit_ledger", {"user_id": uid, "delta": 15, "source": "subscription", "payment_id": spid})
        for charged in ("subscription", "credits"):
            sub = str(uuid.uuid4())
            s.insert("submissions", {"id": sub})
            rid = str(uuid.uuid4())
            s.insert("regenerations", {"id": rid, "user_id": uid, "university_id": uni, "submission_id": sub, "task_id": task,
                                       "status": "done", "charged_from": charged})
            s.insert("credit_ledger", {"user_id": uid, "delta": -1, "source": "generation", "regeneration_id": rid})
        s.close()

        sql = LEDGER_SQL.read_text(encoding="utf-8")
        with psycopg.connect(PG_URL, autocommit=True) as c:
            c.execute(f"set search_path = {schema}, public")
            c.execute(sql)
            c.execute(sql)  # міграцію можна запускати повторно
            for _ in range(2):
                c.execute(REFUNDS_SQL.read_text(encoding="utf-8"))

        s = PgStore(PG_URL, schema)
        b = balance(s, uid)
        assert b["credits"] == 2 and b["subscription"]["credits_left"] == 14  # кеш, що був правдою, збережено
        assert all(r["pool"] for r in ledger(s, user_id=uid))
        assert len(ledger(s, user_id=uid, source="adjustment")) == 1  # вирівнювання — один запис, без дублів після повтору
        assert s.select("billing_reconciliation") == []
        assert_cache_matches_ledger(s, uid)
        # функції закриті від ролей API
        assert s.conn.execute("select has_function_privilege('authenticated', 'billing_consume(uuid, uuid)', 'execute') as x").fetchone()["x"] is False
        assert s.conn.execute("select has_table_privilege('anon', 'billing_reconciliation', 'select') as x").fetchone()["x"] is False
        s.close()
    finally:
        _drop_schema(schema)


# ---------- Повернення коштів за оплати (міграція 15) ----------
def quote(db, pid: str) -> dict:
    return db.rpc("billing_refund_quote", {"p_payment": pid})


def start(db, pid: str, n: int | None = None, force: bool = False) -> dict:
    return db.rpc("billing_refund_start", {"p_payment": pid, "p_generations": n, "p_reason": "запит студента",
                                           "p_admin": None, "p_force": force})


def finish(db, rid: str, ok: bool) -> dict:
    return db.rpc("billing_refund_finish", {"p_refund": rid, "p_success": ok, "p_failure": None if ok else "відмова банку"})


def age_payment(db, pid: str, days: int) -> None:
    when = _now() - timedelta(days=days)
    if isinstance(db, PgStore):
        db.conn.execute("update payments set created_at = %s where id = %s", (when, pid))
    else:
        next(p for p in db.raw("payments") if p["id"] == pid)["created_at"] = when.isoformat()


def test_refund_unused_single_generations(db):
    uid = user(db)
    pid = pay(db, uid, "single", 3)
    consume(db, uid)
    q = quote(db, pid)
    assert q["refundable_generations"] == 2 and q["unit_kop"] == 4700 and q["blocked"] is None
    r = start(db, pid, 2)
    assert r["status"] == "pending" and r["amount_kop"] == 9400 and r["credits_removed"] == 2
    assert balance(db, uid)["credits"] == 0  # генерації забрано одразу, ще до відповіді банку
    with pytest.raises(RpcError, match="refund_pending"):
        start(db, pid, 1)
    assert finish(db, r["id"], True)["status"] == "success"
    assert finish(db, r["id"], False)["status"] == "success"  # повторний виклик нічого не змінює
    q = quote(db, pid)
    assert q["refunded_kop"] == 9400 and q["refundable_generations"] == 0 and q["blocked"] == "used"
    assert_cache_matches_ledger(db, uid)


def test_refund_cannot_take_used_generations_without_force(db):
    uid = user(db)
    pid = pay(db, uid, "single", 2)
    consume(db, uid)
    with pytest.raises(RpcError, match="refund_used"):
        start(db, pid, 2)
    r = start(db, pid, 2, force=True)  # напр. подвійна оплата: гроші за 2, забираємо лише те, що лишилось
    assert r["amount_kop"] == 9400 and r["credits_removed"] == 1 and r["forced"] is True
    assert balance(db, uid)["credits"] == 0


def test_bank_failure_restores_generations(db):
    uid = user(db)
    pid = pay(db, uid, "topup", 2)
    r = start(db, pid, 2)
    assert balance(db, uid)["credits"] == 0
    assert finish(db, r["id"], False)["status"] == "failure"
    assert balance(db, uid)["credits"] == 2
    assert quote(db, pid)["refundable_generations"] == 2  # можна спробувати ще раз
    assert_cache_matches_ledger(db, uid)


def test_refund_window_is_14_days(db):
    uid = user(db)
    pid = pay(db, uid, "single", 1)
    age_payment(db, pid, 15)
    assert quote(db, pid)["blocked"] == "expired"
    with pytest.raises(RpcError, match="refund_expired"):
        start(db, pid, 1)
    assert start(db, pid, 1, force=True)["amount_kop"] == 4700


def test_unpaid_payment_cannot_be_refunded(db):
    uid = user(db)
    pid = payment(db, uid)
    with pytest.raises(RpcError, match="refund_not_paid"):
        start(db, pid, 1, force=True)


def test_unused_subscription_refunded_in_full_and_ends(db):
    uid = user(db)
    pid = pay(db, uid, "subscription", credits=15)
    r = start(db, pid)
    assert r["amount_kop"] == 4700 and r["generations"] == 15 and r["credits_removed"] == 15  # сума оплати підписки
    finish(db, r["id"], True)
    assert balance(db, uid)["subscription"] is None
    with pytest.raises(RpcError, match="no_credits"):
        consume(db, uid)
    assert_cache_matches_ledger(db, uid)


def test_used_subscription_needs_force(db):
    uid = user(db)
    pid = pay(db, uid, "subscription", credits=3)
    consume(db, uid)
    assert quote(db, pid)["blocked"] == "subscription_used"
    with pytest.raises(RpcError, match="refund_subscription_used"):
        start(db, pid)
    r = start(db, pid, force=True)
    assert r["credits_removed"] == 2


def test_refund_of_renewal_shortens_period_and_failure_restores_it(db):
    uid = user(db)
    pay(db, uid, "subscription", credits=15)
    first_end = balance(db, uid)["subscription"]["period_end"]
    renewal = pay(db, uid, "subscription", credits=15)
    r = start(db, renewal)
    b = balance(db, uid)["subscription"]
    assert b["credits_left"] == 15 and b["credits_included"] == 15
    assert datetime.fromisoformat(b["period_end"]) == datetime.fromisoformat(first_end)
    finish(db, r["id"], False)
    b = balance(db, uid)["subscription"]
    assert b["credits_left"] == 30 and b["credits_included"] == 30
    assert datetime.fromisoformat(b["period_end"]) - datetime.fromisoformat(first_end) == timedelta(days=30)
    assert_cache_matches_ledger(db, uid)


# ---------- Безкоштовні генерації на старт (міграція 16) ----------
def test_welcome_generations_granted_exactly_once(db):
    uid = user(db)
    results = _parallel(db, 6, lambda s: s.rpc("billing_grant_welcome", {"p_user": uid, "p_amount": 3}))
    assert results.count(True) == 1 and results.count(False) == 5, results
    assert balance(db, uid)["credits"] == 3
    assert db.rpc("billing_grant_welcome", {"p_user": uid, "p_amount": 0}) is False
    assert [consume(db, uid) for _ in range(3)] == ["credits"] * 3
    with pytest.raises(RpcError, match="no_credits"):
        consume(db, uid)
    assert_cache_matches_ledger(db, uid)
