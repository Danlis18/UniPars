"""Демо-реалізація функцій балансу з міграцій 20261124000014_billing_ledger_balance.sql
і 20261125000015_payment_refunds.sql.

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
    return [s for s in t("subscriptions") if s["user_id"] == user_id and not s.get("canceled_at")
            and _dt(s["period_start"]) <= now <= _dt(s["period_end"])]


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
           "refund_id": None, "created_at": _iso(_now())} | row
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


# ---------- Повернення коштів за оплати (міграція 15) ----------
def _payment(t, p_payment: str) -> dict:
    pay = next((p for p in t("payments") if p["id"] == p_payment), None)
    if not pay:
        raise BillingError("payment_not_found")
    return pay


def _pay_sub_entry(t, p_payment: str) -> dict | None:
    return next(iter(_ledger(t, payment_id=p_payment, source="subscription")), None)


def refund_quote(t, p_payment: str) -> dict:
    pay = _payment(t, p_payment)
    active = [r for r in t("refunds") if r["payment_id"] == p_payment and r["status"] in ("pending", "success")]
    done_gen, done_kop = sum(r["generations"] for r in active), sum(r["amount_kop"] for r in active)
    blocked = None
    if pay["status"] != "success" or not pay.get("applied_at"):
        blocked = "not_paid"
    elif any(r["status"] == "pending" for r in active):
        blocked = "pending"
    if pay["kind"] in ("single", "topup"):
        left = pay["quantity"] - done_gen
        unit = pay["amount_kop"] // pay["quantity"]
        balance = _sum(_ledger(t, user_id=pay["user_id"], pool="credits"))
        can = max(min(left, balance), 0)
    else:
        entry = _pay_sub_entry(t, p_payment)
        sub_id = entry["subscription_id"] if entry else None
        left = 0 if done_gen > 0 else (entry["delta"] if entry else 0)
        unit = pay["amount_kop"]
        balance = _sum(_ledger(t, subscription_id=sub_id)) if sub_id else 0
        used = -sum(r["delta"] for r in _ledger(t, subscription_id=sub_id) if r["source"] in ("generation", "refund")) if sub_id else 0
        can = left if used == 0 else 0
        if used > 0 and blocked is None:
            blocked = "subscription_used"
    if blocked is None and _dt(pay["created_at"]) < _now() - timedelta(days=14):
        blocked = "expired"
    if blocked is None and can == 0:
        blocked = "already_refunded" if left <= 0 else "used"
    return {"kind": pay["kind"], "quantity": pay["quantity"], "amount_kop": pay["amount_kop"],
            "refunded_generations": done_gen, "refunded_kop": done_kop, "max_generations": max(left, 0),
            "refundable_generations": can if blocked is None else 0, "unit_kop": unit, "balance": balance, "blocked": blocked}


def refund_start(t, p_payment: str, p_generations: int, p_reason: str, p_admin: str | None, p_force: bool = False) -> dict:
    pay = _payment(t, p_payment)
    q = refund_quote(t, p_payment)
    if q["blocked"] in ("not_paid", "pending"):
        raise BillingError(f"refund_{q['blocked']}")
    n = q["max_generations"] if pay["kind"] == "subscription" else (p_generations or 0)
    if n <= 0 or n > q["max_generations"]:
        raise BillingError("refund_bad_amount")
    if not p_force and (q["blocked"] is not None or n > q["refundable_generations"]):
        raise BillingError(f"refund_{q['blocked'] or 'used'}")
    amount = pay["amount_kop"] if pay["kind"] == "subscription" else n * q["unit_kop"]
    take = min(n, max(q["balance"], 0))
    refund = {"id": str(uuid.uuid4()), "payment_id": p_payment, "user_id": pay["user_id"], "amount_kop": amount,
              "generations": n, "credits_removed": take, "status": "pending", "reason": p_reason, "forced": bool(p_force),
              "created_by": p_admin, "failure_reason": None, "prev_period_end": None, "prev_credits_included": None,
              "created_at": _iso(_now()), "updated_at": _iso(_now())}
    t("refunds").append(refund)
    if pay["kind"] == "subscription":
        entry = _pay_sub_entry(t, p_payment)
        sub = next(s for s in t("subscriptions") if s["id"] == entry["subscription_id"])
        refund.update(prev_period_end=sub["period_end"], prev_credits_included=sub["credits_included"])
        if _dt(sub["period_end"]) - timedelta(days=30) <= _now():
            sub["canceled_at"] = _iso(_now())
        else:
            sub.update(period_end=_iso(_dt(sub["period_end"]) - timedelta(days=30)), credits_included=max(sub["credits_included"] - n, 1))
        if take > 0:
            _add(t, user_id=pay["user_id"], delta=-take, source="payment_refund", pool="subscription", subscription_id=sub["id"],
                 payment_id=p_payment, refund_id=refund["id"])
    elif take > 0:
        _add(t, user_id=pay["user_id"], delta=-take, source="payment_refund", pool="credits", payment_id=p_payment, refund_id=refund["id"])
    _sync_cache(t, pay["user_id"])
    return dict(refund)


def refund_finish(t, p_refund: str, p_success: bool, p_failure: str | None = None) -> dict:
    refund = next((r for r in t("refunds") if r["id"] == p_refund), None)
    if not refund:
        raise BillingError("refund_not_found")
    if refund["status"] != "pending":
        return dict(refund)
    if p_success:
        refund.update(status="success", updated_at=_iso(_now()))
        return dict(refund)
    take = next(iter(_ledger(t, refund_id=p_refund, source="payment_refund")), None)
    if take:
        _add(t, user_id=take["user_id"], delta=-take["delta"], source="payment_refund_reversal", pool=take["pool"],
             subscription_id=take["subscription_id"], payment_id=take["payment_id"], refund_id=p_refund)
    if refund.get("prev_period_end"):
        entry = _pay_sub_entry(t, refund["payment_id"])
        sub = next(s for s in t("subscriptions") if s["id"] == entry["subscription_id"])
        sub.update(period_end=refund["prev_period_end"], credits_included=refund["prev_credits_included"], canceled_at=None)
    refund.update(status="failure", failure_reason=(p_failure or "Банк відхилив повернення")[:500], updated_at=_iso(_now()))
    _sync_cache(t, refund["user_id"])
    return dict(refund)


# ---------- Безкоштовні генерації на старт (міграція 16) ----------
def grant_welcome(t, p_user: str, p_amount: int) -> bool:
    if (p_amount or 0) <= 0 or _ledger(t, user_id=p_user, source="welcome"):
        return False
    _add(t, user_id=p_user, delta=p_amount, source="welcome", pool="credits")
    _sync_cache(t, p_user)
    return True


FUNCTIONS = {
    "billing_balance": balance,
    "billing_consume": consume,
    "billing_refund": refund,
    "billing_set_status": set_status,
    "billing_refund_quote": refund_quote,
    "billing_refund_start": refund_start,
    "billing_refund_finish": refund_finish,
    "billing_grant_welcome": grant_welcome,
}
