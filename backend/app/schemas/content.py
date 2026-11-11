from __future__ import annotations

from typing import Literal

import re

from pydantic import BaseModel, Field, HttpUrl, field_validator

PostType = Literal["material", "question", "explanation"]
MaterialKind = Literal["notes", "lab_example", "practical", "exam_prep", "link"]


class MaterialIn(BaseModel):
    kind: MaterialKind
    link_url: HttpUrl | None = None
    course: int | None = Field(default=None, ge=1, le=6)
    semester: int | None = Field(default=None, ge=1, le=12)


class QuestionIn(BaseModel):
    tried: str = Field(default="", max_length=5000)
    unclear_step: str = Field(default="", max_length=2000)


class PostCreate(BaseModel):
    type: PostType
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=20000)
    subject_id: str
    topic_id: str | None = None
    visibility: Literal["university", "group"] = "university"
    material: MaterialIn | None = None
    question: QuestionIn | None = None


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=20000)
    topic_id: str | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    parent_id: str | None = None


class ReportCreate(BaseModel):
    target_type: Literal["post", "comment"]
    target_id: str
    reason: str = Field(min_length=3, max_length=1000)


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    bio: str | None = Field(default=None, max_length=500)
    theme: Literal["light", "dark", "system"] | None = None
    locale: Literal["uk"] | None = None
    active_university_id: str | None = None
    telegram: str | None = Field(default=None, max_length=100)

    @field_validator("telegram")
    @classmethod
    def _telegram(cls, v: str | None) -> str | None:
        """Приймає @нік, нік або посилання t.me/нік; зберігає лише нік."""
        if v is None:
            return None
        v = v.strip()
        if not v:
            return ""
        v = re.sub(r"^(https?://)?(www\.)?(t\.me|telegram\.me)/", "", v).lstrip("@").split("?")[0].strip("/")
        if not re.fullmatch(r"[A-Za-z0-9_]{5,32}", v):
            raise ValueError("Нік Telegram: 5–32 символи, латиниця, цифри або _")
        return v


class JoinUniversity(BaseModel):
    faculty_id: str | None = None
    program_id: str | None = None
    course: int | None = Field(default=None, ge=1, le=6)
    group_id: str | None = None


class SubscriptionsSet(BaseModel):
    subject_ids: list[str] = Field(max_length=100)
