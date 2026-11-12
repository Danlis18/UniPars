from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.context import Ctx, ctx
from app.services.messages import MAX_LEN, MessageService

router = APIRouter(prefix="/messages")


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_LEN)


def svc(c: Ctx = Depends(ctx)) -> MessageService:
    return MessageService(c.store, c.access)


@router.get("")
def conversations(m: MessageService = Depends(svc)):
    return m.conversations()


@router.get("/unread")
def unread(m: MessageService = Depends(svc)):
    return {"unread": m.unread_total()}


@router.post("/with/{user_id}")
def open_with(user_id: str, m: MessageService = Depends(svc)):
    return m.open_with(user_id)


@router.get("/{conversation_id}")
def conversation(conversation_id: str, m: MessageService = Depends(svc)):
    return m.get(conversation_id)


@router.get("/{conversation_id}/messages")
def messages(conversation_id: str, limit: int = Query(100, ge=1, le=200), m: MessageService = Depends(svc)):
    return m.messages(conversation_id, limit)


@router.post("/{conversation_id}/messages", status_code=201)
def send(conversation_id: str, data: MessageIn, m: MessageService = Depends(svc)):
    return m.send(conversation_id, data.body)


@router.post("/{conversation_id}/read")
def read(conversation_id: str, m: MessageService = Depends(svc)):
    m.mark_read(conversation_id)
    return {"ok": True}
