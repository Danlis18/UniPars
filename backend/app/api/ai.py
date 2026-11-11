from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse

from app.api.context import Ctx, ctx
from app.core.config import get_settings
from app.integrations.ai.factory import get_provider
from app.schemas.admin_ai import AIMessageIn, ContextPreviewIn, ConversationCreate, ConversationRename
from app.services.ai import AIService

router = APIRouter(prefix="/ai")


@router.get("/status")
def status():
    s = get_settings()
    return {"enabled": s.ai_enabled, "provider": s.ai_provider if s.ai_enabled else None,
            "model": s.ai_model if s.ai_enabled else None}


@router.get("/conversations")
def conversations(c: Ctx = Depends(ctx)):
    return AIService(c.store, c.access).list()


@router.post("/conversations", status_code=201)
def create(data: ConversationCreate, c: Ctx = Depends(ctx), x_university_id: str | None = Header(default=None)):
    return AIService(c.store, c.access).create(x_university_id, data.title)


@router.patch("/conversations/{cid}")
def rename(cid: str, data: ConversationRename, c: Ctx = Depends(ctx)):
    return AIService(c.store, c.access).rename(cid, data.title)


@router.delete("/conversations/{cid}", status_code=204)
def delete(cid: str, c: Ctx = Depends(ctx)):
    AIService(c.store, c.access).delete(cid)


@router.get("/conversations/{cid}/messages")
def messages(cid: str, c: Ctx = Depends(ctx)):
    return AIService(c.store, c.access).messages(cid)


@router.post("/context-preview")
def context_preview(data: ContextPreviewIn, c: Ctx = Depends(ctx)):
    return AIService(c.store, c.access).context_for(data.post_id)


@router.post("/conversations/{cid}/messages")
async def send(cid: str, data: AIMessageIn, c: Ctx = Depends(ctx)):
    s = get_settings()
    gen = await AIService(c.store, c.access).stream_reply(
        get_provider(), cid, data.content, data.context_post_id, data.retry, s.ai_rate_limit_per_minute)
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
