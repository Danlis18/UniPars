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

    def _grant_welcome(self) -> None:
        """Бета: безкоштовні генерації — один раз кожному, хто вже приєднався до університету
        (пройшов онбординг із підтвердженою поштою), щоб голі реєстрації не роздували витрати на AI."""
        n = get_settings().free_generations
        if n <= 0 or getattr(self, "_welcome_checked", False):
            return
        self._welcome_checked = True
        if any(m.get("onboarded") for m in self.s.select("university_memberships", [("user_id", "eq", self.uid)])):
            self.s.rpc("billing_grant_welcome", {"p_user": self.uid, "p_amount": n})

    def payments_available(self) -> bool:
        """Чи може цей користувач оплатити: справжня оплата з опублікованими реквізитами або тестова (демо/модерація)."""
        st = get_settings()
        if st.payment_provider == "monobank":
            return st.legal_ready
        if st.payment_provider == "jar":
            return st.jar_ready
        return self._mock_allowed()

    def _sync_jar_if_waiting(self) -> None:
        """Без webhook: якщо в користувача є неоплачений рахунок на Банку — перечитати виписку (з лімітом monobank)."""
        st = get_settings()
        if st.payment_provider != "jar" or not st.mono_personal_token:
            return
        if not self.s.select("payments", [("user_id", "eq", self.uid), ("provider", "eq", "jar"), ("status", "eq", "created")], limit=1):
            return
        from app.services import jar

        try:
            jar.sync(self.s)
        except Exception:
            pass  # monobank недоступний або ліміт — спробуємо під час наступного перегляду

    def balance(self) -> Row:
        self._sync_jar_if_waiting()
        self._grant_welcome()
        b = self.s.rpc("billing_balance", {"p_user": self.uid})
        sub = b.get("subscription")
        left = sub["credits_left"] if sub else 0
        return {"credits": b["credits"], "subscription": ({"period_end": sub["period_end"], "credits_left": left,
                                                         "credits_included": sub["credits_included"]} if sub else None),
                "available": b["credits"] + left, "prices": self.prices(),
                "payments_available": self.payments_available(), "free_generations": get_settings().free_generations}

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
        if st.payment_provider not in ("monobank", "jar") and not self._mock_allowed():
            raise HTTPException(503, "Оплата ще не підключена. Спробуйте трохи згодом.")
        if st.payment_provider == "jar" and not st.jar_ready:
            raise HTTPException(503, "Оплата тимчасово недоступна. Спробуйте трохи згодом.")
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
        if st.payment_provider == "jar":
            # переказ на Банку з кодом у коментарі; зарахування — за випискою (services/jar.py)
            from app.services import jar

            # унікальна сума (мінус кілька копійок): переказ за номером картки з іншого банку приходить без коментаря,
            # тоді оплату впізнаємо за точною сумою
            row.update(invoice_id=jar.new_code(self.s), page_url=f"/billing/pay/{pid}",
                       amount_kop=jar.unique_amount(self.s, row["amount_kop"]))
        elif st.payment_provider == "monobank":
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
        out = {k: p.get(k) for k in ("id", "kind", "quantity", "amount_kop", "currency", "status", "provider", "page_url",
                                     "failure_reason", "created_at", "applied_at")} | {"label": KIND_LABEL.get(p["kind"], p["kind"])}
        if p.get("provider") == "jar":
            from app.services import jar

            out |= {"code": p.get("invoice_id"), "jar_card": jar.card_number(),
                    "jar_url": jar.pay_url(p["amount_kop"], p.get("invoice_id") or "") if get_settings().mono_jar_url else None}
        return out

    def _own_payment(self, payment_id: str) -> Row:
        p = self.s.get("payments", id=payment_id)
        if not p or p["user_id"] != self.uid:
            raise HTTPException(404, "Платіж не знайдено")
        return p

    def payment(self, payment_id: str) -> Row:
        """Статус платежу (сторінка повернення після оплати). Для monobank — уточнюємо в банку, якщо webhook ще не прийшов."""
        p = self._own_payment(payment_id)
        if p["provider"] == "jar" and p["status"] in ("created", "processing"):
            from app.services import jar

            try:
                jar.sync(self.s)  # не частіше ліміту monobank; між запитами — лише зіставлення вже відомих надходжень
                p = self.s.get("payments", id=payment_id)
            except Exception:
                pass
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
        refunds = self.s.select("refunds", [("user_id", "eq", self.uid)]) if pays else []
        return {"payments": [self._out(p) | {"refunded_kop": sum(r["amount_kop"] for r in refunds
                                                                 if r["payment_id"] == p["id"] and r["status"] == "success")}
                             for p in pays]}

    # ---------- Списання й повернення ----------
    def consume(self, regeneration_id: str) -> str:
        """Списує одну генерацію (спершу з підписки). Повертає гаманець: 'subscription' або 'credits'."""
        self._grant_welcome()
        try:
            return self.s.rpc("billing_consume", {"p_user": self.uid, "p_regeneration": regeneration_id})
        except RpcError as e:
            if "no_credits" in str(e):
                raise HTTPException(402, "Немає доступних генерацій. Оплатіть генерацію або оформіть підписку."
                                    if self.payments_available() else "Безкоштовні генерації закінчились. Оплата з'явиться незабаром.") from e
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


# ---------- Повернення коштів (оферта, розділ 5): лише адміністратор платформи ----------
REFUND_ERRORS = {
    "payment_not_found": (404, "Платіж не знайдено"),
    "refund_not_found": (404, "Повернення не знайдено"),
    "refund_not_paid": (409, "Платіж не оплачено — повертати нічого"),
    "refund_pending": (409, "За цим платежем уже є повернення в обробці"),
    "refund_bad_amount": (422, "Неправильна кількість генерацій для повернення"),
    "refund_expired": (409, "Минуло понад 14 днів від оплати. Повернути можна лише примусово"),
    "refund_used": (409, "Генерації з цієї оплати вже використані. Повернути можна лише примусово"),
    "refund_subscription_used": (409, "З підписки вже використано генерації. Повернути можна лише примусово"),
    "refund_already_refunded": (409, "За цей платіж уже все повернено"),
}


def _refund_error(e: RpcError) -> HTTPException:
    for code, (status, text) in REFUND_ERRORS.items():
        if code in str(e):
            return HTTPException(status, text)
    return HTTPException(500, "Не вдалося виконати повернення")


class RefundService:
    def __init__(self, store: Store, access) -> None:
        if not access.is_platform_admin:
            raise HTTPException(403, "Повернення коштів доступні лише адміністратору платформи")
        self.s = store
        self.a = access

    def payments(self, status: str | None = "success", limit: int = 100) -> list[Row]:
        if get_settings().payment_provider == "jar":
            from app.services import jar

            try:
                jar.sync(self.s)
            except Exception:
                pass
        filters = [("status", "eq", status)] if status else []
        pays = self.s.select("payments", filters, order="created_at", desc=True, limit=limit)
        if not pays:
            return []
        ids = [p["id"] for p in pays]
        refunds = self.s.select("refunds", [("payment_id", "in", ids)], order="created_at", desc=True)
        users = {u["id"]: u for u in self.s.select("profiles", [("id", "in", list({p["user_id"] for p in pays}))])}
        out = []
        for p in pays:
            rs = [r for r in refunds if r["payment_id"] == p["id"]]
            u = users.get(p["user_id"]) or {}
            out.append(BillingService._out(p) | {
                "user": {"id": p["user_id"], "display_name": u.get("display_name") or "Користувач"},
                "provider": p["provider"],
                "refunded_kop": sum(r["amount_kop"] for r in rs if r["status"] in ("pending", "success")),
                "refunds": [self._refund_out(r) for r in rs],
            })
        return out

    @staticmethod
    def _refund_out(r: Row) -> Row:
        return {k: r.get(k) for k in ("id", "payment_id", "amount_kop", "generations", "credits_removed", "status",
                                      "reason", "forced", "failure_reason", "created_at", "updated_at")}

    def quote(self, payment_id: str) -> Row:
        try:
            return self.s.rpc("billing_refund_quote", {"p_payment": payment_id})
        except RpcError as e:
            raise _refund_error(e) from e

    def refund(self, payment_id: str, generations: int | None, reason: str, force: bool) -> Row:
        pay = self.s.get("payments", id=payment_id)
        if not pay:
            raise HTTPException(404, "Платіж не знайдено")
        try:
            r = self.s.rpc("billing_refund_start", {"p_payment": payment_id, "p_generations": generations, "p_reason": reason.strip(),
                                                    "p_admin": self.a.user_id, "p_force": force})
        except RpcError as e:
            raise _refund_error(e) from e
        if pay["provider"] == "mock":
            r = self._finish(r, True)  # тестова оплата: грошей не було — повернення одразу успішне
        elif pay["provider"] == "jar":
            pass  # Банка: гроші повертає адміністратор переказом, потім позначає «Повернено» (complete)
        else:
            r = self._ask_bank(pay, r)
        return self._refund_out(r)

    def refresh(self, refund_id: str) -> Row:
        """Уточнити в банку статус повернення, що лишилося в обробці."""
        r = self.s.get("refunds", id=refund_id)
        if not r:
            raise HTTPException(404, "Повернення не знайдено")
        pay = self.s.get("payments", id=r["payment_id"])
        if r["status"] == "pending" and pay["provider"] == "monobank":
            try:
                status = _monobank().cancel_status(pay["invoice_id"], r["id"])
            except Exception as e:
                raise HTTPException(502, "Банк тимчасово недоступний. Спробуйте за хвилину.") from e
            if status in ("success", "failure"):
                r = self._finish(r, status == "success", "Банк відхилив повернення")
        return self._refund_out(r)

    def complete(self, refund_id: str, success: bool) -> Row:
        """Ручне завершення повернення для оплат на Банку: гроші переказано (або повернення скасовано)."""
        r = self.s.get("refunds", id=refund_id)
        if not r:
            raise HTTPException(404, "Повернення не знайдено")
        pay = self.s.get("payments", id=r["payment_id"])
        if pay["provider"] != "jar":
            raise HTTPException(400, "Вручну завершуються лише повернення оплат на Банку")
        if r["status"] != "pending":
            return self._refund_out(r)
        return self._refund_out(self._finish(r, success, None if success else "Повернення скасовано адміністратором"))

    def jar_transfers(self, unmatched_only: bool = True) -> list[Row]:
        f = [("payment_id", "is_null", True)] if unmatched_only else []
        return self.s.select("jar_transfers", f, order="received_at", desc=True, limit=100)

    def jar_sync(self) -> Row:
        from app.services import jar

        try:
            new = jar.sync(self.s, wait=False)
        except Exception as e:
            raise HTTPException(502, f"monobank: {str(e)[:200]}") from e
        return {"new": new}

    def jar_match(self, transfer_id: str, payment_id: str) -> Row:
        from app.services import jar

        return jar.manual_match(self.s, self.a.user_id, transfer_id, payment_id)

    def _ask_bank(self, pay: Row, r: Row) -> Row:
        from app.integrations.payments.monobank import MonobankRejected

        try:
            status = _monobank().cancel_invoice(invoice_id=pay["invoice_id"], amount_kop=r["amount_kop"], ext_ref=r["id"])
        except MonobankRejected as e:
            return self._finish(r, False, f"Банк відхилив повернення: {str(e)[:200]}")
        except Exception:
            # мережевий збій: результат невідомий — лишаємо «в обробці», статус уточнюється кнопкою «Оновити»
            return r
        if status in ("success", "failure"):
            return self._finish(r, status == "success", "Банк відхилив повернення")
        return r

    def _finish(self, r: Row, success: bool, failure: str | None = None) -> Row:
        r = self.s.rpc("billing_refund_finish", {"p_refund": r["id"], "p_success": success, "p_failure": failure})
        if success:
            from app.services.notifications import notify

            notify(self.s, r["user_id"], None, "billing", "Кошти повернено",
                   f"Повернення {r['amount_kop'] / 100:.2f} ₴ на картку оформлено. Зарахування — до 7 робочих днів, залежно від банку.",
                   "/billing")
        return r
