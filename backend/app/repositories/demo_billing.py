"""Демо-реалізація функцій балансу з міграції 20261124000014_billing_ledger_balance.sql.

Поведінка має збігатися з SQL рядок у рядок: ті самі правила (баланс = сума журналу, списання спершу
з підписки, повернення в той самий гаманець рівно один раз, успішний платіж не понижується, зарахування
рівно один раз). Атомарність забезпечує блокування DemoStore — так само, як pg_advisory_xact_lock у базі.
Тести в tests/test_ledger.py проганяють одні й ті самі сценарії і тут, і на справжньому Postgres.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any


class BillingError(Exception):
    """Помилка функції балансу; message — як у SQL (no_credits, payment_not_found)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


def _dt(v: Any) -> datetime:
    return v if isinstance(v, datetime) else datetime.fromisoformat(str(v))


def _ledger(t, **eq) -> list[dict]:
    return [r for r in t("credit_ledger") if all(r.get(k) == v for k, v in eq.items())]


def _sum(rows) -> int:
    return sum(r["delta"] for r in rows)


def _active_subs(t, user_id: str) -> list[dict]:
    now = _now()
    return [s for s in t("subscriptions") if s["user_id"] == user_id and _dt(s["period_start"]) <= now <= _dt(s["period_end"])]


def _sync_cache(t, user_id: str) -> None:
    credits = _sum(_ledger(t, user_id=user_id, pool="credits"))
    acc = next((a for a in t("billing_accounts") if a["user_id"] == user_id), None)
    if acc:
        acc.update(credits=credits, updated_at=_iso(_now()))
    else:
        t("billing_accounts").append({"user_id": user_id, "credits": credits, "updated_at": _iso(_now()), "created_at": _iso(_now())})
    for s in t("subscriptions"):
        if s["user_id"] == user_id:
            s["credits_left"] = _sum(_ledger(t, subscription_id=s["id"]))


def _add(t, **row) -> None:
    row = {"id": str(uuid.uuid4()), "payment_id": None, "subscription_id": None, "regeneration_id": None,
           "created_at": _iso(_now())} | row
    t("credit_ledger").append(row)


def balance(t, p_user: str) -> dict:
    credits = _sum(_ledger(t, user_id=p_user, pool="credits"))
    subs = sorted(_active_subs(t, p_user), key=lambda s: _dt(s["period_end"]), reverse=True)
    if not subs:
        return {"credits": credits, "subscription": None}
    s = subs[0]
    return {"credits": credits, "subscription": {"id": s["id"], "period_end": s["period_end"],
                                                 "credits_left": _sum(_ledger(t, subscription_id=s["id"])),
                                                 "credits_included": s["credits_included"]}}


def consume(t, p_user: str, p_regeneration: str) -> str:
    done = _ledger(t, regeneration_id=p_regeneration, source="generation")
    if done:
        return done[0]["pool"]
    subs = sorted((s for s in _active_subs(t, p_user) if _sum(_ledger(t, subscription_id=s["id"])) > 0),
                  key=lambda s: _dt(s["period_end"]))
    if subs:
        pool, sub_id = "subscription", subs[0]["id"]
    elif _sum(_ledger(t, user_id=p_user, pool="credits")) > 0:
        pool, sub_id = "credits", None
    else:
        raise BillingError("no_credits")
    _add(t, user_id=p_user, delta=-1, source="generation", pool=pool, subscription_id=sub_id, regeneration_id=p_regeneration)
    _sync_cache(t, p_user)
    return pool


def refund(t, p_regeneration: str) -> bool:
    charge = _ledger(t, regeneration_id=p_regeneration, source="generation")
    if not charge or _ledger(t, regeneration_id=p_regeneration, source="refund"):
        return False
    c = charge[0]
    _add(t, user_id=c["user_id"], delta=1, source="refund", pool=c["pool"], subscription_id=c["subscription_id"],
         regeneration_id=p_regeneration)
    _sync_cache(t, c["user_id"])
    return True


def set_status(t, p_payment: str, p_status: str, p_reason: str | None = None, p_sub_credits: int = 15) -> dict:
    pay = next((p for p in t("payments") if p["id"] == p_payment), None)
    if not pay:
        raise BillingError("payment_not_found")
    if pay["status"] != "success" and pay["status"] != p_status:
        pay.update(status=p_status, failure_reason=p_reason, updated_at=_iso(_now()))
    if pay["status"] == "success" and not pay.get("applied_at"):
        pay["applied_at"] = _iso(_now())
        uid = pay["user_id"]
        if pay["kind"] in ("single", "topup"):
            _add(t, user_id=uid, delta=pay["quantity"], source=pay["kind"], pool="credits", payment_id=pay["id"])
        else:
            n = max(p_sub_credits or 15, 1)
            subs = sorted(_active_subs(t, uid), key=lambda s: _dt(s["period_end"]), reverse=True)
            if subs:  # продовження: +30 днів і +генерації
                s = subs[0]
                s.update(period_end=_iso(_dt(s["period_end"]) + timedelta(days=30)), credits_included=s["credits_included"] + n)
            else:
                s = {"id": str(uuid.uuid4()), "user_id": uid, "period_start": _iso(_now()), "period_end": _iso(_now() + timedelta(days=30)),
                     "credits_included": n, "credits_left": 0, "payment_id": pay["id"], "created_at": _iso(_now())}
                t("subscriptions").append(s)
            _add(t, user_id=uid, delta=n, source="subscription", pool="subscription", subscription_id=s["id"], payment_id=pay["id"])
        _sync_cache(t, uid)
    return dict(pay)


FUNCTIONS = {
    "billing_balance": balance,
    "billing_consume": consume,
    "billing_refund": refund,
    "billing_set_status": set_status,
}
