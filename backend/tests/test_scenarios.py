"""Основні користувацькі сценарії та ізоляція даних."""
from conftest import ANDRII, IRYNA, MAKSYM, OLENA, SOFIIA, UNI_A, UNI_B, as_user, did

import app.api.ai as ai_api
from app.integrations.ai.base import ChatMessage

PRIVATE_B = did("post:micro-private")
GROUP_ONLY = did("post:kn21-only")


# ---------- Автентифікація ----------
def test_requires_auth(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer demo:unknown"}).status_code == 401


# ---------- Ізоляція університетів ----------
def test_other_university_cannot_read_private_material(client):
    # Олена (Політех) не бачить матеріал «Класичного» ні напряму, ні в стрічці, ні через AI-контекст
    assert client.get(f"/api/posts/{PRIVATE_B}", headers=as_user(OLENA)).status_code == 404
    assert client.post("/api/ai/context-preview", json={"post_id": PRIVATE_B}, headers=as_user(OLENA)).status_code == 404
    # Підміна заголовка університету не дає доступу
    r = client.get("/api/posts", headers=as_user(OLENA, UNI_B))
    assert r.status_code == 403
    feed = client.get("/api/posts?limit=50", headers=as_user(OLENA, UNI_A)).json()["items"]
    assert PRIVATE_B not in {p["id"] for p in feed}
    # Софія бачить свій університет
    assert client.get(f"/api/posts/{PRIVATE_B}", headers=as_user(SOFIIA)).status_code == 200


def test_cannot_post_into_foreign_subject(client):
    foreign_subject = did("subj:micro")
    r = client.post("/api/posts", headers=as_user(OLENA, UNI_A),
                    json={"type": "explanation", "title": "x", "body": "y", "subject_id": foreign_subject})
    assert r.status_code == 400


def test_group_visibility(client):
    assert client.get(f"/api/posts/{GROUP_ONLY}", headers=as_user(OLENA)).status_code == 200   # КН-21
    assert client.get(f"/api/posts/{GROUP_ONLY}", headers=as_user(MAKSYM)).status_code == 404  # КН-22


def test_attachment_link_requires_access(client):
    pid = did("post:micro-private")
    up = client.post(f"/api/posts/{pid}/attachments", headers=as_user(SOFIIA),
                     files={"file": ("notes.pdf", b"%PDF-1.4 demo", "application/pdf")})
    assert up.status_code == 201, up.text
    att = up.json()["id"]
    assert client.get(f"/api/attachments/{att}/link", headers=as_user(OLENA)).status_code == 404
    link = client.get(f"/api/attachments/{att}/link", headers=as_user(SOFIIA)).json()["url"]
    assert client.get(link).status_code == 200
    assert client.get(link.replace("sig=", "sig=0")).status_code == 404


def test_upload_validation(client):
    pid = did("post:integrals")
    bad = client.post(f"/api/posts/{pid}/attachments", headers=as_user(OLENA),
                      files={"file": ("virus.exe", b"MZ...", "application/octet-stream")})
    assert bad.status_code == 415
    fake = client.post(f"/api/posts/{pid}/attachments", headers=as_user(OLENA),
                       files={"file": ("doc.pdf", b"not a pdf", "application/pdf")})
    assert fake.status_code == 415
    not_owner = client.post(f"/api/posts/{pid}/attachments", headers=as_user(MAKSYM),
                            files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")})
    assert not_owner.status_code == 403


# ---------- Ролі ----------
def test_student_cannot_escalate_role(client):
    r = client.patch(f"/api/admin/members/{OLENA}", json={"role": "admin"}, headers=as_user(OLENA, UNI_A))
    assert r.status_code == 403
    # «Вступ» повторно не змінює роль
    client.post(f"/api/universities/{UNI_A}/join", json={}, headers=as_user(OLENA))
    me = client.get("/api/me", headers=as_user(OLENA)).json()
    assert next(m for m in me["memberships"] if m["university_id"] == UNI_A)["role"] == "student"


def test_admin_cannot_manage_other_university(client):
    assert client.get("/api/admin/members", headers=as_user(ANDRII, UNI_A)).status_code == 200
    assert client.get("/api/admin/members", headers=as_user(ANDRII, UNI_B)).status_code == 403
    assert client.get("/api/admin/members", headers=as_user(IRYNA, UNI_A)).status_code == 403  # модератор


# ---------- Основний сценарій ----------
def test_question_answer_accept_flow(client):
    h = as_user(OLENA, UNI_A)
    subj = did("subj:algo")
    q = client.post("/api/posts", headers=h, json={
        "type": "question", "title": "Як оцінити складність рекурсії?", "body": "T(n) = 2T(n/2) + n",
        "subject_id": subj, "question": {"tried": "Дерево рекурсії", "unclear_step": "Сума рівнів"}}).json()
    assert q["status"] == "open" and q["question"]["unclear_step"] == "Сума рівнів"

    unanswered = client.get("/api/posts?status=unanswered", headers=h).json()["items"]
    assert q["id"] in {p["id"] for p in unanswered}

    c = client.post(f"/api/posts/{q['id']}/comments", headers=as_user(MAKSYM), json={"body": "Майстер-теорема: $O(n \\log n)$"}).json()
    # Лише автор запитання може прийняти відповідь
    assert client.post(f"/api/comments/{c['id']}/accept", headers=as_user(MAKSYM)).status_code == 403
    solved = client.post(f"/api/comments/{c['id']}/accept", headers=h).json()
    assert solved["status"] == "solved" and solved["accepted_comment_id"] == c["id"]
    reopened = client.post(f"/api/posts/{q['id']}/reopen", headers=h).json()
    assert reopened["status"] == "open"

    notes = client.get("/api/notifications", headers=h).json()
    assert notes["unread"] >= 1
    m_notes = client.get("/api/notifications", headers=as_user(MAKSYM)).json()
    assert any(n["kind"] == "answer_accepted" for n in m_notes["items"])


def test_material_bookmark_and_search(client):
    h = as_user(MAKSYM, UNI_A)
    m = client.post("/api/posts", headers=h, json={
        "type": "material", "title": "Шпаргалка з SQL JOIN", "body": "INNER, LEFT, RIGHT", "subject_id": did("subj:db"),
        "topic_id": did("topic:db:SQL"), "material": {"kind": "notes", "course": 2}}).json()
    assert m["material"]["kind"] == "notes" and m["topic"]["name"] == "SQL"
    assert client.post(f"/api/posts/{m['id']}/bookmark", headers=as_user(OLENA)).json()["saved"]
    saved = client.get("/api/posts?saved=true", headers=as_user(OLENA, UNI_A)).json()["items"]
    assert [p["id"] for p in saved] == [m["id"]]
    found = client.get("/api/posts?q=join&type=material&kind=notes", headers=h).json()["items"]
    assert m["id"] in {p["id"] for p in found}
    # Редагувати чужий допис не можна
    assert client.patch(f"/api/posts/{m['id']}", json={"title": "x"}, headers=as_user(OLENA)).status_code == 403


def test_feed_pagination_and_tabs(client):
    h = as_user(OLENA, UNI_A)
    page1 = client.get("/api/posts?limit=3", headers=h).json()
    assert len(page1["items"]) == 3 and page1["next_offset"] == 3
    mine = client.get("/api/posts?tab=my_subjects&limit=50", headers=h).json()["items"]
    subs = {did("subj:math"), did("subj:algo"), did("subj:db")}
    assert mine and all(p["subject"]["id"] in subs for p in mine)


# ---------- AI ----------
def test_ai_not_connected_is_honest(client):
    h = as_user(OLENA, UNI_A)
    assert client.get("/api/ai/status").json()["enabled"] is False
    conv = client.post("/api/ai/conversations", json={}, headers=h).json()
    r = client.post(f"/api/ai/conversations/{conv['id']}/messages", json={"content": "Привіт"}, headers=h)
    assert r.status_code == 503 and "не підключено" in r.json()["detail"]


def test_ai_conversations_are_private(client, monkeypatch):
    class FakeProvider:
        name = "fake"

        async def stream(self, system, messages: list[ChatMessage]):
            assert messages[-1].role == "user"
            for part in ("Крок 1. ", "Крок 2."):
                yield part

    monkeypatch.setattr(ai_api, "get_provider", lambda: FakeProvider())
    h = as_user(OLENA, UNI_A)
    conv = client.post("/api/ai/conversations", json={}, headers=h).json()
    r = client.post(f"/api/ai/conversations/{conv['id']}/messages", headers=h,
                    json={"content": "Поясни", "context_post_id": did("post:dijkstra")})
    assert r.status_code == 200 and "Крок 2." in r.text
    msgs = client.get(f"/api/ai/conversations/{conv['id']}/messages", headers=h).json()
    assert [m["role"] for m in msgs] == ["user", "assistant"] and "Дейкстра" in msgs[0]["content"]

    other = as_user(SOFIIA)
    assert client.get(f"/api/ai/conversations/{conv['id']}/messages", headers=other).status_code == 404
    assert client.patch(f"/api/ai/conversations/{conv['id']}", json={"title": "x"}, headers=other).status_code == 404
    assert client.delete(f"/api/ai/conversations/{conv['id']}", headers=other).status_code == 404
    assert conv["id"] not in {c["id"] for c in client.get("/api/ai/conversations", headers=other).json()}
    # Чужий приватний матеріал не можна підкласти в контекст
    conv2 = client.post("/api/ai/conversations", json={}, headers=h).json()
    r = client.post(f"/api/ai/conversations/{conv2['id']}/messages", headers=h,
                    json={"content": "x", "context_post_id": PRIVATE_B})
    assert r.status_code == 404


# ---------- Новини ----------
def test_news_per_university(client):
    a = client.get("/api/news", headers=as_user(OLENA, UNI_A)).json()
    assert a["items"] and all(i["is_demo"] for i in a["items"])
    assert client.get("/api/news", headers=as_user(OLENA, UNI_B)).status_code == 403


def test_rss_parsing_and_dedup():
    from app.integrations.news.adapters import parse_feed

    xml = b"""<?xml version="1.0"?><rss><channel>
      <item><title>Hello &amp; welcome</title><link>https://example.org/a</link><guid>a</guid>
            <pubDate>Mon, 10 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Text&lt;/p&gt;</description></item>
      <item><title>Second</title><link>https://example.org/b</link></item></channel></rss>"""
    items = parse_feed(xml)
    assert [i.title for i in items] == ["Hello & welcome", "Second"]
    assert items[0].external_id == "a" and items[0].summary == "Text"


def test_moderation_hides_reported_post(client):
    pid = did("post:bigO")
    assert client.post("/api/reports", headers=as_user(MAKSYM, UNI_A),
                       json={"target_type": "post", "target_id": pid, "reason": "Спам"}).status_code == 201
    reports = client.get("/api/admin/reports", headers=as_user(IRYNA, UNI_A)).json()
    client.post(f"/api/admin/reports/{reports[0]['id']}/resolve", json={"action": "hide"}, headers=as_user(IRYNA, UNI_A))
    assert client.get(f"/api/posts/{pid}", headers=as_user(OLENA)).status_code == 404
    assert client.get(f"/api/posts/{pid}", headers=as_user(IRYNA)).status_code == 200


# ---------- Соцфункції ----------
def test_follow_profile_and_following_feed(client):
    h = as_user(MAKSYM, UNI_A)
    prof = client.get(f"/api/users/{IRYNA}", headers=h).json()
    assert prof["is_following"] and prof["followers"] == 3 and prof["context"]["university"]
    # відписка / підписка, сповіщення
    assert client.post(f"/api/users/{ANDRII}/follow", headers=h).json()["is_following"] is True
    notes = client.get("/api/notifications", headers=as_user(ANDRII)).json()["items"]
    assert any(n["kind"] == "follow" for n in notes)
    assert client.post(f"/api/users/{MAKSYM}/follow", headers=h).status_code == 400
    # стрічка «Підписки» — лише автори, на яких підписаний
    feed = client.get("/api/posts?tab=following&limit=50", headers=h).json()["items"]
    assert feed and {p["author"]["id"] for p in feed} <= {IRYNA, OLENA, ANDRII}
    followers = client.get(f"/api/users/{IRYNA}/followers", headers=h).json()
    assert {u["id"] for u in followers} == {OLENA, MAKSYM, ANDRII}
    # чужий приватний матеріал не рахується в профілі
    assert client.get(f"/api/users/{SOFIIA}", headers=h).json()["posts"] == 0


def test_telegram_validation(client):
    h = as_user(OLENA)
    me = client.patch("/api/me", json={"telegram": "https://t.me/new_nick_1"}, headers=h).json()
    assert me["telegram"] == "new_nick_1"
    assert client.patch("/api/me", json={"telegram": "bad nick!"}, headers=h).status_code == 422
    assert client.patch("/api/me", json={"telegram": ""}, headers=h).json()["telegram"] is None


def test_people_search_in_university(client):
    res = client.get("/api/users?q=Ір", headers=as_user(OLENA, UNI_A)).json()
    assert [u["id"] for u in res] == [IRYNA]
    # людей іншого університету не видно
    assert SOFIIA not in {u["id"] for u in client.get("/api/users", headers=as_user(OLENA, UNI_A)).json()}


# ---------- Особисті повідомлення ----------
def test_direct_messages_permissions_and_flow(client):
    # Максим підписаний на Олену → Олена може написати Максиму, а Софія (інший університет, не підписана) — ні
    assert client.post(f"/api/messages/with/{MAKSYM}", headers=as_user(SOFIIA)).status_code == 403
    assert client.get(f"/api/users/{MAKSYM}", headers=as_user(OLENA)).json()["can_message"] is True
    conv = client.post(f"/api/messages/with/{MAKSYM}", headers=as_user(OLENA)).json()
    assert conv["can_send"] and conv["user"]["id"] == MAKSYM
    # повторне відкриття повертає той самий діалог
    assert client.post(f"/api/messages/with/{MAKSYM}", headers=as_user(OLENA)).json()["id"] == conv["id"]

    assert client.post(f"/api/messages/{conv['id']}/messages", json={"body": "Привіт!"}, headers=as_user(OLENA)).status_code == 201
    assert client.get("/api/messages/unread", headers=as_user(MAKSYM)).json()["unread"] == 1
    lst = client.get("/api/messages", headers=as_user(MAKSYM)).json()
    assert lst[0]["id"] == conv["id"] and lst[0]["unread"] == 1 and lst[0]["last_message"]["body"] == "Привіт!"
    client.post(f"/api/messages/{conv['id']}/read", headers=as_user(MAKSYM))
    assert client.get("/api/messages/unread", headers=as_user(MAKSYM)).json()["unread"] == 0
    # Максим відповідає
    assert client.post(f"/api/messages/{conv['id']}/messages", json={"body": "Hi"}, headers=as_user(MAKSYM)).status_code == 201

    # Чужий діалог недоступний
    other = as_user(SOFIIA)
    assert client.get(f"/api/messages/{conv['id']}/messages", headers=other).status_code == 404
    assert client.post(f"/api/messages/{conv['id']}/messages", json={"body": "x"}, headers=other).status_code == 404
    assert client.get("/api/messages", headers=other).json() == []


def test_comment_replies(client):
    pid = did("post:eigen")
    root = client.post(f"/api/posts/{pid}/comments", json={"body": "Спробуй раціональні корені"}, headers=as_user(MAKSYM)).json()
    reply = client.post(f"/api/posts/{pid}/comments", json={"body": "Дякую!", "parent_id": root["id"]}, headers=as_user(OLENA)).json()
    assert reply["parent_id"] == root["id"]
    # відповідь на коментар іншого допису відхиляється
    bad = client.post(f"/api/posts/{did('post:bigO')}/comments", json={"body": "x", "parent_id": root["id"]}, headers=as_user(OLENA))
    assert bad.status_code == 400
    notes = client.get("/api/notifications", headers=as_user(MAKSYM)).json()["items"]
    assert any(n["kind"] == "reply" for n in notes)
