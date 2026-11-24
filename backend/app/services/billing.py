"""Оплата й баланс генерацій.

- Разова генерація: 47 ₴ → +1 генерація (без терміну дії).
- Підписка: 350 ₴ → 15 генерацій на 30 днів; повторна оплата продовжує період і додає генерації.
- Докупівля (лише з активною підпискою): 18 ₴ за генерацію.
Списання: спершу генерації підписки, потім разові. Невдала генерація повертається.
Провайдер: mock (тестова сторінка оплати, без грошей) або monobank (рахунок + webhook з підписом).

Баланс = сума записів credit_ledger. Списання, повернення й зарахування оплати — атомарні функції бази
(міграція 20261124000014: billing_consume / billing_refund / billing_set_status / billing_balance)
з блокуванням на користувача; лічильники billing_accounts.credits і subscriptions.credits_left — лише кеш.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.repositories.store import Row, RpcError, Store

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

    def active_subscription(self) -> Row | None:
        return self.s.rpc("billing_balance", {"p_user": self.uid}).get("subscription")

    def balance(self) -> Row:
        b = self.s.rpc("billing_balance", {"p_user": self.uid})
        sub = b.get("subscription")
        left = sub["credits_left"] if sub else 0
        return {"credits": b["credits"], "subscription": ({"period_end": sub["period_end"], "credits_left": left,
                                                         "credits_included": sub["credits_included"]} if sub else None),
                "available": b["credits"] + left, "prices": self.prices()}

    # ---------- Оформлення оплати ----------
    def _mock_allowed(self) -> bool:
        """Тестова оплата: у демо — всім; на продакшні — лише модерації/адміністраторам (для показу), якщо не дозволено всім."""
        st = get_settings()
        if st.is_demo or st.mock_payments_for_all:
            return True
        prof = self.s.get("profiles", id=self.uid) or {}
        if prof.get("is_platform_admin"):
            return True
        return any(m.get("role") in ("moderator", "admin") for m in self.s.select("university_memberships", [("user_id", "eq", self.uid)]))

    def checkout(self, kind: str, quantity: int = 1) -> Row:
        st = get_settings()
        if st.payment_provider != "monobank" and not self._mock_allowed():
            raise HTTPException(503, "Оплата ще не підключена. Спробуйте трохи згодом.")
        if st.payment_provider == "monobank" and not st.legal_ready:
            # гроші приймаємо лише за опублікованою офертою з реквізитами продавця (LEGAL_* і SUPPORT_EMAIL)
            raise HTTPException(503, "Оплата тимчасово недоступна. Спробуйте трохи згодом.")
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
        if p["provider"] != "mock" or get_settings().payment_provider != "mock" or not self._mock_allowed():
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
        """Списує одну генерацію (спершу з підписки). Повертає гаманець: 'subscription' або 'credits'."""
        try:
            return self.s.rpc("billing_consume", {"p_user": self.uid, "p_regeneration": regeneration_id})
        except RpcError as e:
            if "no_credits" in str(e):
                raise HTTPException(402, "Немає доступних генерацій. Оплатіть генерацію або оформіть підписку.") from e
            raise

    def refund(self, source: str, regeneration_id: str) -> None:
        """Повертає генерацію в той гаманець, з якого її списали; повторне повернення ігнорується."""
        self.s.rpc("billing_refund", {"p_regeneration": regeneration_id})


# ---------- Зміна статусу й зарахування (спільне для mock, webhook і перевірки статусу) ----------
def set_status(store: Store, p: Row, status: str, reason: str | None = None) -> None:
    """Успішний платіж не понижується (webhook-и можуть приходити не по порядку); зарахування — рівно один раз."""
    store.rpc("billing_set_status", {"p_payment": p["id"], "p_status": status, "p_reason": reason,
                                     "p_sub_credits": get_settings().subscription_credits})


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
