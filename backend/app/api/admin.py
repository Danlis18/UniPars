from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from app.api.context import Ctx, ctx
from app.core.auth import university_header
from app.schemas import admin_ai as S
from app.services import news as news_service
from app.services.admin import AdminService, create_university

router = APIRouter(prefix="/admin")


def svc(c: Ctx = Depends(ctx), uni: str = Depends(university_header)) -> AdminService:
    return AdminService(c.store, c.access, uni)


@router.get("/overview")
def overview(a: AdminService = Depends(svc)):
    return a.overview()


@router.get("/members")
def members(a: AdminService = Depends(svc)):
    return a.members()


@router.patch("/members/{user_id}")
def set_role(user_id: str, data: S.MemberRoleUpdate, a: AdminService = Depends(svc)):
    return a.set_role(user_id, data)


@router.post("/faculties", status_code=201)
def add_faculty(data: S.FacultyCreate, a: AdminService = Depends(svc)):
    return a.add_faculty(data)


@router.post("/programs", status_code=201)
def add_program(data: S.ProgramCreate, a: AdminService = Depends(svc)):
    return a.add_program(data)


@router.post("/groups", status_code=201)
def add_group(data: S.GroupCreate, a: AdminService = Depends(svc)):
    return a.add_group(data)


@router.post("/subjects", status_code=201)
def add_subject(data: S.SubjectCreate, a: AdminService = Depends(svc)):
    return a.add_subject(data)


@router.post("/subjects/{subject_id}/topics", status_code=201)
def add_topic(subject_id: str, data: S.TopicCreate, a: AdminService = Depends(svc)):
    return a.add_topic(subject_id, data)


@router.patch("/settings")
def settings(data: dict = Body(...), a: AdminService = Depends(svc)):
    return a.update_settings(data)


@router.get("/news-sources")
def sources(a: AdminService = Depends(svc)):
    return a.sources()


@router.post("/news-sources", status_code=201)
def add_source(data: S.NewsSourceIn, a: AdminService = Depends(svc)):
    return a.add_source(data)


@router.put("/news-sources/{source_id}")
def update_source(source_id: str, data: S.NewsSourceIn, a: AdminService = Depends(svc)):
    return a.update_source(source_id, data)


@router.delete("/news-sources/{source_id}", status_code=204)
def delete_source(source_id: str, a: AdminService = Depends(svc)):
    a.delete_source(source_id)


@router.post("/news-sources/{source_id}/sync")
async def sync_source(source_id: str, a: AdminService = Depends(svc)):
    a._admin()
    return await news_service.sync_source(a.s, a._source(source_id))


@router.post("/announcements", status_code=201)
def announce(data: S.AnnouncementIn, a: AdminService = Depends(svc)):
    return a.announce(data)


@router.get("/reports")
def reports(status: str = "open", a: AdminService = Depends(svc)):
    return a.reports(status)


@router.post("/reports/{report_id}/resolve")
def resolve(report_id: str, data: S.ReportResolve, a: AdminService = Depends(svc)):
    return a.resolve(report_id, data)


@router.post("/universities", status_code=201)
def new_university(data: S.UniversityCreate, c: Ctx = Depends(ctx)):
    return create_university(c.store, c.access, data)
