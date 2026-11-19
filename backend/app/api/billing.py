"""Оплата, підписки, баланс і регенерація звітів."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from pydantic import BaseModel, Field

from app.api.context import Ctx, ctx
from app.core.deps import get_storage, get_store
from app.services import billing as billing_service
from app.services.billing import BillingService
from app.services.regeneration import RegenerationService

router = APIRouter()


class Checkout(BaseModel):
    kind: Literal["single", "subscription", "topup"]
    quantity: int = Field(default=1, ge=1, le=50)


class MockResult(BaseModel):
    success: bool = True


class RegenerateOptions(BaseModel):
    rewrite: dict[Literal["headings", "theory", "procedure", "conclusions"], bool]
    emphasis: dict[Literal["bold", "italic", "underline"], bool] = {}


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
    billing_service.monobank_webhook(get_store(), await request.body(), x_sign)
    return {"ok": True}


@router.post("/submissions/{submission_id}/regenerate", status_code=201)
def regenerate(submission_id: str, data: RegenerateOptions, background: BackgroundTasks, c: Ctx = Depends(ctx)):
    return RegenerationService(c.store, c.access).start(submission_id, data.model_dump(), get_storage(), background)


@router.get("/regenerations")
def my_regenerations(c: Ctx = Depends(ctx)):
    return RegenerationService(c.store, c.access).mine()


@router.get("/regenerations/{regeneration_id}")
def regeneration(regeneration_id: str, c: Ctx = Depends(ctx)):
    return RegenerationService(c.store, c.access).get(regeneration_id, get_storage())
