"""Оплата й баланс генерацій.

- Разова генерація: 47 ₴ → +1 генерація (без терміну дії).
- Підписка: 350 ₴ → 15 генерацій на 30 днів; повторна оплата продовжує період і додає генерації.
- Докупівля (лише з активною підпискою): 18 ₴ за генерацію.
Списання: спершу генерації підписки, потім разові. Невдала генерація повертається.
Провайдер: mock (тестова сторінка оплати, без грошей) або monobank (рахунок + webhook з підписом).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.repositories.store import Row, Store

KIND_LABEL = {"single": "Регенерація звіту", "subscription": "Підписка UniPars на 30 днів", "topup": "Додаткові генерації"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


def _monobank():
    from app.integrations.payments.monobank import Monobank

    return Monobank(get_settings().monobank_token)


class BillingService:
    def __init__(self, store: Store, user_id: str) -> None:
        self.s = store
        self.uid = user_id

    # ---------- Ціни й баланс ----------
    @staticmethod
    def prices() -> Row:
        st = get_settings()
        return {"single_kop": st.price_single_kop, "subscription_kop": st.price_subscription_kop,
                "subscription_credits": st.subscription_credits, "topup_kop": st.price_topup_kop,
                "currency": "UAH", "provider": st.payment_provider}

    def _account(self) -> Row:
        acc = self.s.get("billing_accounts", user_id=self.uid)
        if not acc:
            acc = self.s.insert("billing_accounts", {"user_id": self.uid, "credits": 0, "updated_at": _iso(_now())})
        return acc

    def active_subscription(self) -> Row | None:
        now = _iso(_now())
        subs = [s for s in self.s.select("subscriptions", [("user_id", "eq", self.uid), ("period_end", "gte", now)], order="period_end", desc=True)
                if s["period_start"] <= now]
        return subs[0] if subs else None

    def balance(self) -> Row:
        acc = self._account()
        sub = self.active_subscription()
        left = sub["credits_left"] if sub else 0
        return {"credits": acc["credits"], "subscription": ({"period_end": sub["period_end"], "credits_left": sub["credits_left"],
                                                             "credits_included": sub["credits_included"]} if sub else None),
                "available": acc["credits"] + left, "prices": self.prices()}

    # ---------- Оформлення оплати ----------
    def checkout(self, kind: str, quantity: int = 1) -> Row:
        st = get_settings()
        if kind not in KIND_LABEL:
            raise HTTPException(400, "Невідомий тип оплати")
        if kind == "topup" and not self.active_subscription():
            raise HTTPException(400, "Докупити генерації за 18 ₴ можна лише з активною підпискою")
        quantity = 1 if kind == "subscription" else max(1, min(int(quantity or 1), 50))
        unit = {"single": st.price_single_kop, "subscription": st.price_subscription_kop, "topup": st.price_topup_kop}[kind]
        pid = str(uuid.uuid4())
        row = {"id": pid, "user_id": self.uid, "kind": kind, "quantity": quantity, "amount_kop": unit * quantity,
               "currency": "UAH", "status": "created", "provider": st.payment_provider, "invoice_id": None, "page_url": None,
               "failure_reason": None, "applied_at": None, "created_at": _iso(_now()), "updated_at": _iso(_now())}
        if st.payment_provider == "monobank":
            webhook = f"{st.public_api_url}/api/billing/monobank/webhook" if st.public_api_url else None
            try:
                inv = _monobank().create_invoice(
                    amount_kop=row["amount_kop"], reference=pid,
                    destination=f"UniPars: {KIND_LABEL[kind]}" + (f" × {quantity}" if quantity > 1 else ""),
                    redirect_url=f"{st.frontend_url}/billing/return/{pid}", webhook_url=webhook)
            except Exception as e:
                raise HTTPException(502, "Платіжний сервіс тимчасово недоступний. Спробуйте за хвилину.") from e
            row.update(invoice_id=inv["invoice_id"], page_url=inv["page_url"])
        else:
            # тестовий режим: власна сторінка оплати без реальних грошей
            row.update(invoice_id=f"mock-{pid}", page_url=f"/billing/checkout/{pid}")
        self.s.insert("payments", row)
        return self._out(row)

    @staticmethod
    def _out(p: Row) -> Row:
        return {k: p.get(k) for k in ("id", "kind", "quantity", "amount_kop", "currency", "status", "provider", "page_url",
                                      "failure_reason", "created_at", "applied_at")} | {"label": KIND_LABEL.get(p["kind"], p["kind"])}

    def _own_payment(self, payment_id: str) -> Row:
        p = self.s.get("payments", id=payment_id)
        if not p or p["user_id"] != self.uid:
            raise HTTPException(404, "Платіж не знайдено")
        return p

    def payment(self, payment_id: str) -> Row:
        """Статус платежу (сторінка повернення після оплати). Для monobank — уточнюємо в банку, якщо webhook ще не прийшов."""
        p = self._own_payment(payment_id)
        if p["provider"] == "monobank" and p["status"] in ("created", "processing") and p.get("invoice_id"):
            try:
                set_status(self.s, p, _monobank().invoice_status(p["invoice_id"]))
                p = self.s.get("payments", id=payment_id)
            except Exception:
                pass
        return self._out(p)

    def mock_complete(self, payment_id: str, success: bool) -> Row:
        p = self._own_payment(payment_id)
        if p["provider"] != "mock" or get_settings().payment_provider != "mock":
            raise HTTPException(400, "Тестова оплата недоступна")
        if p["status"] in ("success", "failure", "expired"):
            return self._out(p)
        set_status(self.s, p, "success" if success else "failure", None if success else "Оплату скасовано (тестовий режим)")
        return self._out(self.s.get("payments", id=payment_id))

    def history(self) -> Row:
        pays = self.s.select("payments", [("user_id", "eq", self.uid)], order="created_at", desc=True, limit=50)
        return {"payments": [self._out(p) for p in pays]}

    # ---------- Списання й повернення ----------
    def consume(self, regeneration_id: str) -> str:
        sub = self.active_subscription()
        if sub and sub["credits_left"] > 0:
            self.s.update("subscriptions", {"id": sub["id"]}, {"credits_left": sub["credits_left"] - 1})
            source = "subscription"
        else:
            acc = self._account()
            if acc["credits"] <= 0:
                raise HTTPException(402, "Немає доступних генерацій. Оплатіть генерацію або оформіть підписку.")
            self.s.update("billing_accounts", {"user_id": self.uid}, {"credits": acc["credits"] - 1, "updated_at": _iso(_now())})
            source = "credits"
        self.s.insert("credit_ledger", {"user_id": self.uid, "delta": -1, "source": "generation", "payment_id": None,
                                        "regeneration_id": regeneration_id, "created_at": _iso(_now())})
        return source

    def refund(self, source: str, regeneration_id: str) -> None:
        sub = self.active_subscription()
        if source == "subscription" and sub:
            self.s.update("subscriptions", {"id": sub["id"]}, {"credits_left": sub["credits_left"] + 1})
        else:
            acc = self._account()
            self.s.update("billing_accounts", {"user_id": self.uid}, {"credits": acc["credits"] + 1, "updated_at": _iso(_now())})
        self.s.insert("credit_ledger", {"user_id": self.uid, "delta": 1, "source": "refund", "payment_id": None,
                                        "regeneration_id": regeneration_id, "created_at": _iso(_now())})


# ---------- Зміна статусу й зарахування (спільне для mock, webhook і перевірки статусу) ----------
def set_status(store: Store, p: Row, status: str, reason: str | None = None) -> None:
    if p["status"] == status and (status != "success" or p.get("applied_at")):
        return
    if p["status"] == "success" and status != "success":
        return  # webhook-и можуть приходити не по порядку: успішний платіж не відкочуємо
    store.update("payments", {"id": p["id"]}, {"status": status, "failure_reason": reason, "updated_at": _iso(_now())})
    if status == "success":
        apply_payment(store, store.get("payments", id=p["id"]))


def apply_payment(store: Store, p: Row) -> None:
    """Зараховує оплату рівно один раз."""
    if p.get("applied_at") or p["status"] != "success":
        return
    store.update("payments", {"id": p["id"]}, {"applied_at": _iso(_now())})
    st = get_settings()
    svc = BillingService(store, p["user_id"])
    if p["kind"] in ("single", "topup"):
        acc = svc._account()
        store.update("billing_accounts", {"user_id": p["user_id"]}, {"credits": acc["credits"] + p["quantity"], "updated_at": _iso(_now())})
        store.insert("credit_ledger", {"user_id": p["user_id"], "delta": p["quantity"], "source": p["kind"], "payment_id": p["id"],
                                       "regeneration_id": None, "created_at": _iso(_now())})
    else:
        sub = svc.active_subscription()
        if sub:  # продовження: +30 днів і +15 генерацій
            end = datetime.fromisoformat(sub["period_end"]) + timedelta(days=30)
            store.update("subscriptions", {"id": sub["id"]}, {"period_end": _iso(end), "credits_left": sub["credits_left"] + st.subscription_credits,
                                                              "credits_included": sub["credits_included"] + st.subscription_credits})
        else:
            store.insert("subscriptions", {"user_id": p["user_id"], "period_start": _iso(_now()), "period_end": _iso(_now() + timedelta(days=30)),
                                           "credits_included": st.subscription_credits, "credits_left": st.subscription_credits,
                                           "payment_id": p["id"], "created_at": _iso(_now())})
        store.insert("credit_ledger", {"user_id": p["user_id"], "delta": st.subscription_credits, "source": "subscription",
                                       "payment_id": p["id"], "regeneration_id": None, "created_at": _iso(_now())})


def monobank_webhook(store: Store, body: bytes, x_sign: str) -> None:
    from app.integrations.payments.monobank import STATUS

    if get_settings().payment_provider != "monobank":
        raise HTTPException(404, "Недоступно")
    if not x_sign or not _monobank().verify(body, x_sign):
        raise HTTPException(400, "Невірний підпис")
    data = json.loads(body.decode("utf-8"))
    rows = store.select("payments", [("invoice_id", "eq", data.get("invoiceId"))], limit=1)
    if not rows:
        return  # не наш рахунок — відповідаємо 200, щоб банк не повторював
    status = STATUS.get(data.get("status", ""), "processing")
    set_status(store, rows[0], status, data.get("failureReason"))
