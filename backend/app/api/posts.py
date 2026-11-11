"""Дописи, матеріали, запитання, коментарі, закладки, скарги, файли."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.api.context import Ctx, ctx
from app.core.auth import university_header
from app.core.config import get_settings
from app.core.deps import get_storage
from app.schemas.content import CommentCreate, PostCreate, PostUpdate, ReportCreate
from app.services.posts import PostService

router = APIRouter()


def svc(c: Ctx) -> PostService:
    return PostService(c.store, c.access)


@router.get("/posts")
def list_posts(
    tab: Literal["for_me", "my_subjects", "university"] = "university",
    type: Literal["material", "question", "explanation"] | None = None,
    subject_id: str | None = None, topic_id: str | None = None,
    status: Literal["open", "solved", "unanswered"] | None = None,
    q: str | None = Query(None, max_length=100), kind: str | None = None,
    course: int | None = None, semester: int | None = None,
    saved: bool = False, author: Literal["me"] | None = None, sort: Literal["new", "popular"] = "new",
    offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50),
    c: Ctx = Depends(ctx), uni: str = Depends(university_header),
):
    return svc(c).list(uni, tab=tab, type=type, subject_id=subject_id, topic_id=topic_id, status=status, q=q, kind=kind,
                       course=course, semester=semester, saved=saved, author=author, sort=sort, offset=offset, limit=limit)


@router.post("/posts", status_code=201)
def create_post(data: PostCreate, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).create(uni, data)


@router.get("/posts/{post_id}")
def get_post(post_id: str, c: Ctx = Depends(ctx)):
    return svc(c).get(post_id)


@router.patch("/posts/{post_id}")
def update_post(post_id: str, data: PostUpdate, c: Ctx = Depends(ctx)):
    return svc(c).update(post_id, data)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: str, c: Ctx = Depends(ctx)):
    svc(c).delete(post_id, get_storage())


@router.post("/posts/{post_id}/attachments", status_code=201)
async def upload(post_id: str, file: UploadFile = File(...), c: Ctx = Depends(ctx)):
    max_mb = get_settings().max_upload_mb
    data = await file.read(max_mb * 1024 * 1024 + 1)
    return svc(c).add_attachment(post_id, file.filename or "file", file.content_type or "", data, get_storage(), max_mb)


@router.get("/attachments/{attachment_id}/link")
def attachment_link(attachment_id: str, c: Ctx = Depends(ctx)):
    return svc(c).attachment_link(attachment_id, get_storage())


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: str, c: Ctx = Depends(ctx)):
    svc(c).delete_attachment(attachment_id, get_storage())


@router.post("/posts/{post_id}/useful")
def useful_post(post_id: str, c: Ctx = Depends(ctx)):
    return svc(c).toggle_useful("post", post_id)


@router.post("/posts/{post_id}/bookmark")
def bookmark(post_id: str, c: Ctx = Depends(ctx)):
    return svc(c).toggle_bookmark(post_id)


@router.post("/posts/{post_id}/reopen")
def reopen(post_id: str, c: Ctx = Depends(ctx)):
    return svc(c).reopen(post_id)


@router.get("/posts/{post_id}/comments")
def comments(post_id: str, c: Ctx = Depends(ctx)):
    return svc(c).comments(post_id)


@router.post("/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: str, data: CommentCreate, c: Ctx = Depends(ctx)):
    return svc(c).add_comment(post_id, data)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: str, c: Ctx = Depends(ctx)):
    svc(c).delete_comment(comment_id)


@router.post("/comments/{comment_id}/useful")
def useful_comment(comment_id: str, c: Ctx = Depends(ctx)):
    return svc(c).toggle_useful("comment", comment_id)


@router.post("/comments/{comment_id}/accept")
def accept(comment_id: str, c: Ctx = Depends(ctx)):
    return svc(c).accept(comment_id)


@router.post("/reports", status_code=201)
def report(data: ReportCreate, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    svc(c).report(uni, data)
    return {"ok": True}
