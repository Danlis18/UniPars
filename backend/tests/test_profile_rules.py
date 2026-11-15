"""Реєстрація лише на відкриті факультети, курс від року вступу, предмети за програмою, аватари, боти."""
import io
from datetime import date, datetime, timedelta, timezone

from conftest import ANDRII, IRYNA, MAKSYM, OLENA, SOFIIA, UNI_A, UNI_B, as_user, did
from PIL import Image

from app.core import academic
from app.repositories.demo_store import get_demo_store
from app.services import bots

FAC_IT, FAC_PHYS = did("fac:it"), did("fac:phys")
PROG_CS = did("prog:cs")


def _join(client, user, **body):
    return client.post(f"/api/universities/{UNI_A}/join", json=body, headers=as_user(user))


def test_signup_only_open_faculty_and_required_context(client):
    # закритий факультет не видно і на нього не можна записатися
    st = client.get(f"/api/universities/{UNI_A}/structure", headers=as_user(SOFIIA)).json()
    assert {f["id"] for f in st["faculties"]} == {FAC_IT}
    assert _join(client, SOFIIA, faculty_id=FAC_PHYS, program_id=PROG_CS, course=1).status_code in (400, 403)
    # без спеціальності чи курсу — помилка
    assert _join(client, SOFIIA, faculty_id=FAC_IT, course=1).status_code == 400
    assert _join(client, SOFIIA, faculty_id=FAC_IT, program_id=PROG_CS, course=2).status_code == 200


def test_closed_university_hidden(client, fresh_store):
    fresh_store.update("universities", {"id": UNI_B}, {"settings": {"registration_open": False}})
    names = {u["id"] for u in client.get("/api/universities", headers=as_user(OLENA)).json()}
    assert UNI_B not in names
    # учасник закритого університету все одно його бачить
    assert UNI_B in {u["id"] for u in client.get("/api/universities", headers=as_user(SOFIIA)).json()}


def test_role_kept_after_rejoin(client):
    _join(client, OLENA, faculty_id=FAC_IT, program_id=PROG_CS, course=2)
    me = client.get("/api/me", headers=as_user(OLENA)).json()
    assert next(m for m in me["memberships"] if m["university_id"] == UNI_A)["role"] == "student"
    assert _join(client, ANDRII, faculty_id=FAC_IT, program_id=PROG_CS, course=2).status_code == 200
    me = client.get("/api/me", headers=as_user(ANDRII)).json()
    assert next(m for m in me["memberships"] if m["university_id"] == UNI_A)["role"] == "admin"


def test_course_advances_on_september_1(client, monkeypatch):
    monkeypatch.setattr(academic, "today", lambda: date(2026, 11, 16))
    _join(client, OLENA, faculty_id=FAC_IT, program_id=PROG_CS, course=2, group_id=did("grp:kn21"))
    m = lambda: next(x for x in client.get("/api/me", headers=as_user(OLENA)).json()["memberships"] if x["university_id"] == UNI_A)
    assert m()["course"] == 2 and m()["entry_year"] == 2025
    monkeypatch.setattr(academic, "today", lambda: date(2027, 8, 31))
    assert m()["course"] == 2
    monkeypatch.setattr(academic, "today", lambda: date(2027, 9, 1))
    assert m()["course"] == 3


def test_group_follows_course(client, fresh_store, monkeypatch):
    fresh_store.insert("study_groups", {"id": "grp-kn31", "university_id": UNI_A, "program_id": PROG_CS, "name": "КН-31", "course": 3})
    monkeypatch.setattr(academic, "today", lambda: date(2026, 11, 16))
    _join(client, OLENA, faculty_id=FAC_IT, program_id=PROG_CS, course=2, group_id=did("grp:kn21"))
    monkeypatch.setattr(academic, "today", lambda: date(2027, 9, 2))
    m = next(x for x in client.get("/api/me", headers=as_user(OLENA)).json()["memberships"] if x["university_id"] == UNI_A)
    assert m["course"] == 3 and m["group_id"] == "grp-kn31"


def test_subjects_filtered_by_program_and_course(client, monkeypatch):
    monkeypatch.setattr(academic, "today", lambda: date(2026, 11, 16))
    _join(client, OLENA, faculty_id=FAC_IT, program_id=PROG_CS, course=1)
    h = as_user(OLENA, UNI_A)
    all_ = {s["slug"] for s in client.get("/api/subjects", headers=h).json()}
    course1 = {s["slug"] for s in client.get("/api/subjects?scope=course", headers=h).json()}
    program = {s["slug"] for s in client.get("/api/subjects?scope=program", headers=h).json()}
    assert course1 and course1 < program <= all_
    assert "algo" in program and "algo" not in course1  # 2-й курс
    assert "math" in course1


def _png(w=900, h=600) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (20, 200, 180)).save(buf, "PNG")
    return buf.getvalue()


def test_avatar_upload_resized_and_served(client):
    h = as_user(MAKSYM)
    r = client.post("/api/me/avatar", headers=h, files={"file": ("me.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    url = r.json()["avatar_url"]
    img = client.get(url)
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp"
    assert Image.open(io.BytesIO(img.content)).size == (512, 512)
    assert client.get("/api/me", headers=h).json()["avatar_url"] == url
    # не зображення
    bad = client.post("/api/me/avatar", headers=h, files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 415
    # видалення
    assert client.delete("/api/me/avatar", headers=h).json()["avatar_url"] is None
    assert client.get(url).status_code == 404


def test_bots_are_labeled_and_like_gradually(client, fresh_store):
    ids = bots.ensure_bots(fresh_store, 4)
    assert len(ids) == 4 and len(bots.ensure_bots(fresh_store, 4)) == 4  # ідемпотентно
    pid = did("post:eigen")
    before = fresh_store.get("posts", id=pid)["useful_count"]
    now = datetime.now(timezone.utc) + timedelta(minutes=1)
    assert bots.like_tick(fresh_store, now) >= 1
    after_one = fresh_store.get("posts", id=pid)["useful_count"]
    assert after_one == before + 1  # не більше одного лайку за цикл
    for _ in range(10):
        bots.like_tick(fresh_store, now)
    final = fresh_store.get("posts", id=pid)["useful_count"]
    assert before < final <= before + 4
    # позначка «Бот», боти поза пошуком людей, писати й підписуватися на ботів не можна
    prof = client.get(f"/api/users/{ids[0]}", headers=as_user(OLENA)).json()
    assert prof["is_bot"] is True and prof["can_message"] is False
    people = {u["id"] for u in client.get("/api/users", headers=as_user(OLENA, UNI_A)).json()}
    assert not people & set(ids)
    assert client.post(f"/api/users/{ids[0]}/follow", headers=as_user(OLENA)).status_code == 400
    assert client.post(f"/api/messages/with/{ids[0]}", headers=as_user(OLENA)).status_code == 403


def test_followers_lists_visible(client):
    followers = client.get(f"/api/users/{IRYNA}/followers", headers=as_user(MAKSYM)).json()
    following = client.get(f"/api/users/{MAKSYM}/following", headers=as_user(OLENA)).json()
    assert {u["id"] for u in followers} == {OLENA, MAKSYM, ANDRII}
    assert {u["id"] for u in following} == {IRYNA, OLENA}
