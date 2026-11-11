from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class AIMessageIn(BaseModel):
    content: str = Field(default="", max_length=20000)
    context_post_id: str | None = None
    retry: bool = False


class ContextPreviewIn(BaseModel):
    post_id: str


class MemberRoleUpdate(BaseModel):
    role: Literal["student", "moderator", "admin"]


class SubjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    description: str = Field(default="", max_length=2000)
    program_ids: list[str] = []
    course: int | None = Field(default=None, ge=1, le=6)
    semester: int | None = Field(default=None, ge=1, le=12)


class TopicCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class NewsSourceIn(BaseModel):
    kind: Literal["json_api", "rss", "manual"]
    name: str = Field(min_length=2, max_length=120)
    url: HttpUrl | None = None
    config: dict = {}
    refresh_minutes: int = Field(default=30, ge=5, le=1440)
    is_enabled: bool = True


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    summary: str = Field(default="", max_length=1000)
    url: HttpUrl | None = None


class ReportResolve(BaseModel):
    action: Literal["hide", "dismiss"]


class UniversityCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    short_name: str = Field(min_length=2, max_length=60)
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")


class FacultyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)


class ProgramCreate(BaseModel):
    faculty_id: str
    name: str = Field(min_length=2, max_length=200)
    code: str | None = None


class GroupCreate(BaseModel):
    program_id: str
    name: str = Field(min_length=1, max_length=40)
    course: int | None = Field(default=None, ge=1, le=6)
