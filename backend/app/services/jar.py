"""Оплата на monobank «Банку» з кодом у коментарі (PAYMENT_PROVIDER=jar).

1. checkout видає код (UP-7K3QX) і посилання на Банку з сумою;
2. студент переказує гроші, вписавши код у коментар;
3. monobank надсилає webhook → backend сам читає виписку Банки (тілу webhook не довіряємо),
   записує кожне надходження в jar_transfers і зараховує оплату, якщо код збігся, а суми досить
   (billing_set_status — рівно один раз; одна транзакція банку — один платіж);
4. надходження без коду чи з меншою сумою адміністратор зіставляє вручну (Керування → Оплати).

monobank дозволяє читати виписку не частіше 1 разу на 60 с — тому синхронізація має спільний обмежувач.
"""
from __future__ import annotations

import re
import secrets
import threading
import time
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.repositories.store import Row, Store

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # без 0/O, 1/I — щоб код легко переписати
CODE_RE = re.compile(r"UP\s*-?\s*([A-Z0-9]{5})", re.I)
MIN_INTERVAL = 61  # секунд між запитами виписки (ліміт monobank — 60 с)
LOOKBACK = 3 * 86400  # виписку беремо за 3 доби: webhook міг загубитися

_lock = threading.Lock()
_last_fetch = 0.0


def _client():
    from app.integrations.payments.mono_personal import MonoPersonal

    return MonoPersonal(get_settings().mono_personal_token)


def new_code(store: Store) -> str:
    while True:
        code = "UP-" + "".join(secrets.choice(ALPHABET) for _ in range(5))
        if not store.select("payments", [("invoice_id", "eq", code)], limit=1):
            return code


# кирилиця, схожа на латиницю: студенти часто набирають код українською розкладкою
_LOOKALIKE = str.maketrans("АВЕКМНОРСТХУІ", "ABEKMHOPCTXYI")


def find_code(comment: str | None) -> str | None:
    m = CODE_RE.search((comment or "").upper().translate(_LOOKALIKE))
    return f"UP-{m.group(1)}" if m else None


def pay_url(amount_kop: int, code: str) -> str:
    """Посилання на Банку з сумою й коментарем (a — сума в гривнях, t — коментар)."""
    from urllib.parse import quote

    base = get_settings().mono_jar_url.rstrip("/")
    amount = f"{amount_kop / 100:.2f}".rstrip("0").rstrip(".")
    return f"{base}?a={amount}&t={quote(code)}"


def sync(store: Store, *, wait: bool = False) -> int:
    """Перечитати виписку Банки й зарахувати оплати. Повертає кількість нових надходжень.
    wait=False — якщо ліміт monobank ще не минув, нічого не робить (для сторінки оплати, що опитує статус);
    wait=True — чекає, доки можна (для webhook у фоні)."""
    global _last_fetch
    st = get_settings()
    if not st.mono_personal_token or not st.mono_jar_id:
        return 0
    with _lock:
        left = MIN_INTERVAL - (time.monotonic() - _last_fetch)
        if left > 0:
            if not wait:
                return match_pending(store)
            time.sleep(left)
        _last_fetch = time.monotonic()
        now = int(time.time())
        items = _client().statement(st.mono_jar_id, now - LOOKBACK, now)
    new = 0
    known = {t["id"] for t in store.select("jar_transfers", [("id", "in", [str(i.get("id")) for i in items])])} if items else set()
    for it in items:
        tid = str(it.get("id") or "")
        if not tid or tid in known or int(it.get("amount") or 0) <= 0:
            continue  # лише надходження (поповнення Банки), кожне — один раз
        try:
            store.insert("jar_transfers", {
                "id": tid, "amount_kop": int(it["amount"]), "comment": (it.get("comment") or "")[:500],
                "counter_name": (it.get("counterName") or it.get("description") or "")[:200],
                "received_at": datetime.fromtimestamp(int(it.get("time") or now), timezone.utc).isoformat(),
                "payment_id": None, "matched_by": None, "matched_at": None})
            new += 1
        except Exception:
            pass  # паралельна синхронізація вже записала це надходження
    match_pending(store)
    return new


def _link(store: Store, transfer: Row, payment: Row, admin_id: str | None) -> bool:
    """Прив'язати надходження до платежу й зарахувати оплату (рівно один раз)."""
    from app.services.billing import set_status

    try:
        store.update("payments", {"id": payment["id"]}, {"provider_ref": transfer["id"]})
    except Exception:
        return False  # цю транзакцію вже використано для іншого платежу
    store.update("jar_transfers", {"id": transfer["id"]}, {"payment_id": payment["id"], "matched_by": admin_id,
                                                            "matched_at": datetime.now(timezone.utc).isoformat()})
    set_status(store, payment, "success")
    return True


def match_pending(store: Store) -> int:
    """Зарахувати оплати для надходжень, де в коментарі є код, а суми досить."""
    done = 0
    for t in store.select("jar_transfers", [("payment_id", "is_null", True)], order="received_at"):
        code = find_code(t.get("comment"))
        if not code:
            continue
        rows = store.select("payments", [("invoice_id", "eq", code), ("provider", "eq", "jar")], limit=1)
        if not rows:
            continue
        p = rows[0]
        if p["status"] == "success" or p.get("provider_ref") or t["amount_kop"] < p["amount_kop"]:
            continue  # уже оплачено або сума менша — вирішує адміністратор
        done += _link(store, t, p, None)
    return done


def manual_match(store: Store, admin_id: str, transfer_id: str, payment_id: str) -> Row:
    t = store.get("jar_transfers", id=transfer_id)
    p = store.get("payments", id=payment_id)
    if not t or not p or p["provider"] != "jar":
        raise HTTPException(404, "Надходження або платіж не знайдено")
    if t.get("payment_id"):
        raise HTTPException(409, "Це надходження вже зараховано")
    if p["status"] == "success":
        raise HTTPException(409, "Цей платіж уже оплачено")
    if not _link(store, t, p, admin_id):
        raise HTTPException(409, "Не вдалося зіставити: транзакцію вже використано")
    return store.get("jar_transfers", id=transfer_id)
