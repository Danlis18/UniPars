"""Завдання предметів, подання робіт і модерація."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.api.context import Ctx, ctx
from app.core.auth import university_header
from app.core.config import get_settings
from app.core.deps import get_storage
from app.schemas.content import AssignMaterial, SubmissionReview, TaskBulkCreate, TaskCreate, TaskUpdate
from app.services.tasks import TaskService

router = APIRouter()
Kind = Literal["lab", "practical", "module", "exam"]


def svc(c: Ctx) -> TaskService:
    return TaskService(c.store, c.access)


async def _read(file: UploadFile) -> bytes:
    return await file.read(get_settings().max_upload_mb * 1024 * 1024 + 1)


@router.get("/subjects/{key}/tasks")
def list_tasks(key: str, kind: Kind | None = None, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).list_tasks(uni, key, kind)


@router.get("/tasks/{task_id}")
def get_task(task_id: str, c: Ctx = Depends(ctx)):
    return svc(c).get_task(task_id)


@router.post("/tasks", status_code=201)
def create_task(data: TaskCreate, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).create_task(uni, data)


@router.post("/tasks/bulk", status_code=201)
def bulk_create(data: TaskBulkCreate, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).bulk_create(uni, data)


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, data: TaskUpdate, c: Ctx = Depends(ctx)):
    return svc(c).update_task(task_id, data)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, c: Ctx = Depends(ctx)):
    svc(c).delete_task(task_id, get_storage())


@router.post("/tasks/{task_id}/files", status_code=201)
async def add_task_file(task_id: str, file: UploadFile = File(...), c: Ctx = Depends(ctx)):
    data = await _read(file)
    return svc(c).add_task_file(task_id, file.filename or "file", file.content_type or "", data, get_storage(), get_settings().max_upload_mb)


@router.delete("/task-files/{file_id}", status_code=204)
def delete_task_file(file_id: str, c: Ctx = Depends(ctx)):
    svc(c).delete_task_file(file_id, get_storage())


@router.get("/task-files/{file_id}/link")
def task_file_link(file_id: str, c: Ctx = Depends(ctx)):
    return svc(c).task_file_link(file_id, get_storage())


@router.post("/tasks/{task_id}/submissions", status_code=201)
async def submit(task_id: str, file: UploadFile = File(...), comment: str = Form(""), c: Ctx = Depends(ctx)):
    data = await _read(file)
    return svc(c).submit(task_id, file.filename or "file", file.content_type or "", data, comment, get_storage(), get_settings().max_upload_mb)


@router.get("/me/submissions")
def my_submissions(c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).my_submissions(uni)


@router.delete("/submissions/{submission_id}", status_code=204)
def withdraw(submission_id: str, c: Ctx = Depends(ctx)):
    svc(c).withdraw(submission_id, get_storage())


@router.get("/submissions/{submission_id}/link")
def submission_link(submission_id: str, c: Ctx = Depends(ctx)):
    return svc(c).submission_link(submission_id, get_storage())


@router.get("/moderation/submissions")
def queue(status: Literal["pending", "approved", "rejected"] = "pending", c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).queue(uni, status)


@router.post("/moderation/submissions/{submission_id}")
def review(submission_id: str, data: SubmissionReview, c: Ctx = Depends(ctx)):
    return svc(c).review(submission_id, data.action, data.note)


@router.get("/moderation/unassigned")
def unassigned(c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).unassigned(uni)


@router.post("/moderation/assign", status_code=201)
def assign(data: AssignMaterial, c: Ctx = Depends(ctx)):
    return svc(c).assign(data.attachment_id, data.task_id)


@router.get("/home")
def home(c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).home(uni)


@router.get("/users/{user_id}/works")
def works(user_id: str, c: Ctx = Depends(ctx), uni: str = Depends(university_header)):
    return svc(c).published_by(uni, user_id)
