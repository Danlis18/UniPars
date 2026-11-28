"""Оплата, підписки, баланс і регенерація звітів."""
from __future__ import annotations

from fastapi.concurrency import run_in_threadpool

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.context import Ctx, ctx
from app.core.deps import get_storage, get_store
from app.services import billing as billing_service
from app.services.billing import BillingService, RefundService
from app.services.regeneration import RegenerationService

router = APIRouter()


class Checkout(BaseModel):
    kind: Literal["single", "subscription", "topup"]
    quantity: int = Field(default=1, ge=1, le=50)


class MockResult(BaseModel):
    success: bool = True


class RefundRequest(BaseModel):
    generations: int | None = Field(default=None, ge=1, le=100)  # для підписки не потрібно — лише повністю
    reason: str = Field(min_length=3, max_length=500)
    force: bool = False  # подвійна оплата або результат не відповідає опису — без обмежень 14 днів/використання


class RefundComplete(BaseModel):
    success: bool = True


class JarMatch(BaseModel):
    payment_id: str


class RegenerateOptions(BaseModel):
    pass  # налаштувань немає: стилізація випадкова, підзаголовки/теорія/хід роботи — дослівно


@router.get("/billing")
def balance(c: Ctx = Depends(ctx)):
    return BillingService(c.store, c.user.id).balance()


@router.post("/billing/checkout", status_code=201)
def checkout(data: Checkout, c: Ctx = Depends(ctx)):
    return BillingService(c.store, c.user.id).checkout(data.kind, data.quantity)


@router.get("/billing/payments/{payment_id}")
def payment(payment_id: str, c: Ctx = Depends(ctx)):
    return BillingService(c.store, c.user.id).payment(payment_id)


@router.post("/billing/mock/{payment_id}")
def mock_pay(payment_id: str, data: MockResult, c: Ctx = Depends(ctx)):
    return BillingService(c.store, c.user.id).mock_complete(payment_id, data.success)


@router.get("/billing/history")
def history(c: Ctx = Depends(ctx)):
    return BillingService(c.store, c.user.id).history()


@router.post("/billing/monobank/webhook")
async def monobank_webhook(request: Request, x_sign: str = Header(default="")):
    # без авторизації користувача: справжність перевіряється підписом monobank (X-Sign)
    body = await request.body()
    await run_in_threadpool(billing_service.monobank_webhook, get_store(), body, x_sign)
    return {"ok": True}


@router.post("/submissions/{submission_id}/regenerate", status_code=201)
def regenerate(submission_id: str, background: BackgroundTasks, data: RegenerateOptions | None = None, c: Ctx = Depends(ctx)):
    return RegenerationService(c.store, c.access).start(submission_id, {}, get_storage(), background)


@router.get("/regenerations")
def my_regenerations(c: Ctx = Depends(ctx)):
    return RegenerationService(c.store, c.access).mine()


@router.get("/regenerations/{regeneration_id}")
def regeneration(regeneration_id: str, c: Ctx = Depends(ctx)):
    return RegenerationService(c.store, c.access).get(regeneration_id, get_storage())


# ---------- Повернення коштів (адміністратор платформи) ----------
@router.get("/admin/payments")
def admin_payments(status: str = "success", c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).payments(None if status == "all" else status)


@router.get("/admin/payments/{payment_id}/refund-quote")
def refund_quote(payment_id: str, c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).quote(payment_id)


@router.post("/admin/payments/{payment_id}/refunds", status_code=201)
def create_refund(payment_id: str, data: RefundRequest, c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).refund(payment_id, data.generations, data.reason, data.force)


@router.post("/admin/refunds/{refund_id}/refresh")
def refresh_refund(refund_id: str, c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).refresh(refund_id)


@router.post("/admin/refunds/{refund_id}/complete")
def complete_refund(refund_id: str, data: RefundComplete, c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).complete(refund_id, data.success)


# ---------- Оплата на Банку (PAYMENT_PROVIDER=jar) ----------
@router.get("/admin/jar-transfers")
def jar_transfers(all: bool = False, c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).jar_transfers(unmatched_only=not all)


@router.post("/admin/jar-transfers/sync")
def jar_sync(c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).jar_sync()


@router.post("/admin/jar-transfers/{transfer_id}/match")
def jar_match(transfer_id: str, data: JarMatch, c: Ctx = Depends(ctx)):
    return RefundService(c.store, c.access).jar_match(transfer_id, data.payment_id)


def _jar_secret_ok(secret: str) -> bool:
    import hmac

    from app.core.config import get_settings

    expected = get_settings().mono_webhook_secret
    return len(expected) >= 16 and hmac.compare_digest(secret, expected)


@router.get("/billing/mono-jar/webhook/{secret}")
def jar_webhook_check(secret: str):
    """monobank перевіряє адресу webhook GET-запитом — відповідаємо 200."""
    if not _jar_secret_ok(secret):
        raise HTTPException(404, "Не знайдено")
    return {"ok": True}


@router.post("/billing/mono-jar/webhook/{secret}")
def jar_webhook(secret: str, background: BackgroundTasks):
    """Нова операція в monobank. Тілу не довіряємо (webhook не підписаний) — лише перечитуємо виписку у фоні."""
    if not _jar_secret_ok(secret):
        raise HTTPException(404, "Не знайдено")
    from app.services import jar

    background.add_task(jar.sync, get_store(), wait=True)
    return {"ok": True}
