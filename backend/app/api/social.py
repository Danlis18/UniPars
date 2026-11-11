from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api.context import Ctx, ctx
from app.core.auth import university_header
from app.services.social import SocialService

router = APIRouter()


@router.get("/users")
def people(q: str | None = Query(None, max_length=60), suggest: bool = False, limit: int = Query(20, ge=1, le=50),
           c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return SocialService(c.store, c.access).people(uni, q, suggest, limit)


@router.get("/users/{user_id}")
def profile(user_id: str, c: Ctx = Depends(ctx)):
    return SocialService(c.store, c.access).profile(user_id)


@router.post("/users/{user_id}/follow")
def follow(user_id: str, c: Ctx = Depends(ctx)):
    return SocialService(c.store, c.access).toggle_follow(user_id)


@router.get("/users/{user_id}/{kind}")
def connections(user_id: str, kind: Literal["followers", "following"], c: Ctx = Depends(ctx)):
    return SocialService(c.store, c.access).list(user_id, kind)
