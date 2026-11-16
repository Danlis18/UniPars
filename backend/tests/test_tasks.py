"""Навчальний посібник: завдання, подання, модерація, права доступу, форум предмета."""
from conftest import ANDRII, IRYNA, MAKSYM, OLENA, SOFIIA, UNI_A, as_user, did

PDF = b"%PDF-1.4\n%demo\n" + b"0" * 200
DB1, DB2 = did("task:db-lab1"), did("task:db-lab2")


def submit(client, user, task_id, comment="", data=PDF, name="report.pdf", mime="application/pdf"):
    return client.post(f"/api/tasks/{task_id}/submissions", headers=as_user(user, UNI_A),
                       files={"file": (name, data, mime)}, data={"comment": comment})


def test_subject_sections_and_task_page(client):
    h = as_user(OLENA, UNI_A)
    r = client.get("/api/subjects/db/tasks?kind=lab", headers=h).json()
    assert [t["number"] for t in r["items"]] == [1, 2, 3]
    assert r["counts"] == {"lab": 3, "practical": 1, "module": 1, "exam": 1}
    lab1 = r["items"][0]
    assert lab1["examples"] == 2 and lab1["questions"] == 1 and r["can_manage"] is False
    t = client.get(f"/api/tasks/{DB1}", headers=h).json()
    assert t["kind_label"] == "Лабораторна робота" and t["subject"]["slug"] == "db"
    assert len(t["examples"]) == 2 and t["next"]["number"] == 2 and t["prev"] is None
    # Чужі коментарі для модератора в опублікованих прикладах не показуються
    assert all("comment" not in e for e in t["examples"])


def test_full_submission_flow_approve(client):
    r = submit(client, OLENA, DB1, comment="Мій варіант")
    assert r.status_code == 201
    sub = r.json()
    assert sub["status"] == "pending" and sub["status_label"] == "На розгляді"
    # На сторінці завдання робота ще не з'явилась, але автор бачить своє подання
    page = client.get(f"/api/tasks/{DB1}", headers=as_user(OLENA, UNI_A)).json()
    assert sub["id"] not in {e["id"] for e in page["examples"]}
    assert page["my_submissions"][0]["id"] == sub["id"]
    # Інший студент не може відкрити файл на розгляді
    assert client.get(f"/api/submissions/{sub['id']}/link", headers=as_user(MAKSYM)).status_code == 404
    assert client.get(f"/api/submissions/{sub['id']}/link", headers=as_user(OLENA)).status_code == 200
    # Модерація бачить у черзі й відкриває файл
    queue = client.get("/api/moderation/submissions", headers=as_user(IRYNA, UNI_A)).json()
    assert sub["id"] in {q["id"] for q in queue}
    assert client.get(f"/api/submissions/{sub['id']}/link", headers=as_user(IRYNA)).status_code == 200
    ok = client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "approve"}, headers=as_user(IRYNA))
    assert ok.json()["status"] == "approved"
    # Повторне схвалення не дублює
    client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "approve"}, headers=as_user(IRYNA))
    page = client.get(f"/api/tasks/{DB1}", headers=as_user(MAKSYM, UNI_A)).json()
    assert [e["id"] for e in page["examples"]].count(sub["id"]) == 1 and len(page["examples"]) == 3
    # Тепер файл доступний усім учасникам, лічильник завантажень росте
    assert client.get(f"/api/submissions/{sub['id']}/link", headers=as_user(MAKSYM)).status_code == 200
    # Автор отримав сповіщення
    notes = client.get("/api/notifications", headers=as_user(OLENA)).json()["items"]
    assert notes[0]["kind"] == "submission_approved"
    # Інший університет не бачить
    assert client.get(f"/api/submissions/{sub['id']}/link", headers=as_user(SOFIIA)).status_code == 404


def test_reject_requires_reason_and_is_private(client):
    sub = submit(client, MAKSYM, DB2).json()
    bad = client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "reject"}, headers=as_user(IRYNA))
    assert bad.status_code == 400
    r = client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "reject", "note": "Додайте висновки"}, headers=as_user(IRYNA))
    assert r.json()["status"] == "rejected"
    mine = client.get("/api/me/submissions", headers=as_user(MAKSYM, UNI_A)).json()
    me = next(x for x in mine if x["id"] == sub["id"])
    assert me["review_note"] == "Додайте висновки" and me["task"]["number"] == 2 and me["subject"]["slug"] == "db"
    assert client.get(f"/api/submissions/{sub['id']}/link", headers=as_user(OLENA)).status_code == 404
    page = client.get(f"/api/tasks/{DB2}", headers=as_user(OLENA, UNI_A)).json()
    assert sub["id"] not in {e["id"] for e in page["examples"]}


def test_student_cannot_moderate_or_manage(client):
    sub = submit(client, OLENA, DB1).json()
    h = as_user(MAKSYM, UNI_A)
    assert client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "approve"}, headers=h).status_code == 403
    assert client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "approve"}, headers=as_user(OLENA)).status_code == 403
    assert client.get("/api/moderation/submissions", headers=h).status_code == 403
    assert client.post("/api/tasks", headers=h, json={"subject_id": did("subj:db"), "kind": "lab", "number": 9, "title": "x"}).status_code == 403
    assert client.delete(f"/api/tasks/{DB1}", headers=h).status_code == 403
    # Автор може відкликати лише своє подання на розгляді
    assert client.delete(f"/api/submissions/{sub['id']}", headers=h).status_code == 404
    assert client.delete(f"/api/submissions/{sub['id']}", headers=as_user(OLENA)).status_code == 204


def test_submission_validation_and_limits(client):
    assert submit(client, OLENA, DB1, data=b"MZ\x90\x00", name="virus.pdf").status_code == 415
    assert submit(client, OLENA, DB1, name="run.exe", mime="application/octet-stream").status_code == 415
    for _ in range(3):
        assert submit(client, OLENA, DB1).status_code == 201
    assert submit(client, OLENA, DB1).status_code == 429


def test_staff_manage_tasks_and_files(client):
    h = as_user(ANDRII, UNI_A)
    t = client.post("/api/tasks", headers=h, json={"subject_id": did("subj:db"), "kind": "lab", "number": 4,
                                                    "title": "Транзакції", "deadline_at": "2030-01-01T10:00:00Z"}).json()
    assert t["number"] == 4 and t["deadline_at"].startswith("2030-01-01")
    assert client.post("/api/tasks", headers=h, json={"subject_id": did("subj:db"), "kind": "lab", "number": 4, "title": "x"}).status_code == 409
    bulk = client.post("/api/tasks/bulk", headers=h, json={"subject_id": did("subj:db"), "kind": "lab", "count": 6}).json()
    assert bulk["created"] == 2  # №1–4 уже є, додано №5 і №6
    f = client.post(f"/api/tasks/{t['id']}/files", headers=h, files={"file": ("umova.pdf", PDF, "application/pdf")}).json()
    page = client.get(f"/api/tasks/{t['id']}", headers=as_user(OLENA, UNI_A)).json()
    assert page["files"][0]["file_name"] == "umova.pdf"
    assert client.get(f"/api/task-files/{f['id']}/link", headers=as_user(OLENA)).status_code == 200
    assert client.get(f"/api/task-files/{f['id']}/link", headers=as_user(SOFIIA)).status_code == 403
    # Завдання з поданнями не видаляється
    assert client.delete(f"/api/tasks/{DB1}", headers=h).status_code == 409
    assert client.delete(f"/api/tasks/{t['id']}", headers=h).status_code == 204


def test_assign_legacy_material_once(client):
    h = as_user(ANDRII, UNI_A)
    items = client.get("/api/moderation/unassigned", headers=h).json()
    att = next(i for i in items if i["file_name"] == "normalization-3nf.pdf")
    r = client.post("/api/moderation/assign", headers=h, json={"attachment_id": att["id"], "task_id": DB2})
    assert r.status_code == 201 and r.json()["status"] == "approved" and r.json()["author"]["id"] == IRYNA
    assert client.post("/api/moderation/assign", headers=h, json={"attachment_id": att["id"], "task_id": DB2}).status_code == 409
    assert att["id"] not in {i["id"] for i in client.get("/api/moderation/unassigned", headers=h).json()}
    # Старий допис і далі відкривається, а файл не видаляється разом із ним
    assert client.get(f"/api/posts/{did('post:normalization')}", headers=as_user(OLENA)).status_code == 200


def test_forum_question_linked_to_task(client):
    h = as_user(MAKSYM, UNI_A)
    q = client.post("/api/posts", headers=h, json={"type": "question", "title": "Як оформити висновки?", "body": "",
                                                   "subject_id": did("subj:db"), "task_id": DB2}).json()
    assert q["task"]["number"] == 2
    lst = client.get(f"/api/posts?type=question&subject_id={did('subj:db')}&task_id={DB2}", headers=h).json()["items"]
    assert [p["id"] for p in lst] == [q["id"]]
    # Завдання з іншого предмета прив'язати не можна
    bad = client.post("/api/posts", headers=h, json={"type": "question", "title": "x", "subject_id": did("subj:math"), "task_id": DB2})
    assert bad.status_code == 400
    a = client.post(f"/api/posts/{q['id']}/comments", headers=as_user(IRYNA), json={"body": "Коротко: що зроблено і що вийшло."})
    assert a.status_code == 201


def test_home_deadlines_and_materials(client):
    home = client.get("/api/home", headers=as_user(OLENA, UNI_A)).json()
    # Олена підписана на math, algo, db — дедлайни лише з них, від найближчого
    assert [d["subject"]["slug"] for d in home["deadlines"]] == ["db", "algo", "db", "db"]
    assert home["deadlines"][0]["number"] == 1 and home["deadlines"][0]["kind"] == "lab"
    assert home["materials_mode"] == "recent" and home["materials"][0]["status"] == "approved"
    sub_id = home["materials"][-1]["id"]
    client.get(f"/api/submissions/{sub_id}/link", headers=as_user(OLENA))
    home = client.get("/api/home", headers=as_user(OLENA, UNI_A)).json()
    assert home["materials_mode"] == "popular" and home["materials"][0]["id"] == sub_id


def test_file_links_inline_for_preview_and_attachment_for_download(client):
    h = as_user(OLENA, UNI_A)
    sub_id = did("sub:db-lab1-iryna")
    view = client.get(client.get(f"/api/submissions/{sub_id}/link", headers=h).json()["url"])
    assert view.status_code == 200 and view.content.startswith(b"%PDF")
    assert view.headers["content-disposition"].startswith("inline")
    assert view.headers["content-type"] == "application/pdf"
    dl = client.get(client.get(f"/api/submissions/{sub_id}/link?download=true", headers=h).json()["url"])
    assert dl.headers["content-disposition"].startswith("attachment")
    # режим захищений підписом: підмінити «i» на «a» в токені не вийде
    url = client.get(f"/api/submissions/{sub_id}/link", headers=h).json()["url"]
    token, sig = url.split("/api/files/")[1].split("?sig=")
    import base64
    forged = base64.urlsafe_b64encode(base64.urlsafe_b64decode(token).replace(b"|i|", b"|a|")).decode()
    assert client.get(f"/api/files/{forged}?sig={sig}").status_code == 404


def test_anonymous_submission_hides_author_from_students_only(client):
    sub = client.post(f"/api/tasks/{DB1}/submissions", headers=as_user(OLENA, UNI_A),
                      files={"file": ("anon.pdf", PDF, "application/pdf")}, data={"anonymous": "true"}).json()
    assert sub["is_anonymous"] is True and sub["author"]["id"] == OLENA  # автор бачить себе
    queue = client.get("/api/moderation/submissions", headers=as_user(IRYNA, UNI_A)).json()
    assert next(q for q in queue if q["id"] == sub["id"])["author"]["id"] == OLENA  # модерація бачить автора
    client.post(f"/api/moderation/submissions/{sub['id']}", json={"action": "approve"}, headers=as_user(IRYNA))
    ex = next(e for e in client.get(f"/api/tasks/{DB1}", headers=as_user(MAKSYM, UNI_A)).json()["examples"] if e["id"] == sub["id"])
    assert ex["author"] == {"id": None, "display_name": "Анонімний студент", "avatar_url": None}
    home = client.get("/api/home", headers=as_user(MAKSYM, UNI_A)).json()["materials"]
    assert all(m["author"]["id"] != OLENA for m in home if m["id"] == sub["id"])
    # у профілі Олени для інших анонімної роботи немає, для неї самої — є
    assert sub["id"] not in {w["id"] for w in client.get(f"/api/users/{OLENA}/works", headers=as_user(MAKSYM, UNI_A)).json()}
    assert sub["id"] in {w["id"] for w in client.get(f"/api/users/{OLENA}/works", headers=as_user(OLENA, UNI_A)).json()}


def test_cyrillic_file_names_get_ascii_storage_keys(client):
    r = client.post(f"/api/tasks/{DB1}/submissions", headers=as_user(OLENA, UNI_A),
                    files={"file": ("Звіт лаб 1.pdf", PDF, "application/pdf")})
    assert r.status_code == 201 and r.json()["file_name"] == "Звіт лаб 1.pdf"
    from app.repositories.demo_store import get_demo_store
    row = get_demo_store().get("submissions", id=r.json()["id"])
    assert row["storage_path"].isascii() and row["storage_path"].endswith(".pdf")
    dl = client.get(client.get(f"/api/submissions/{r.json()['id']}/link?download=true", headers=as_user(OLENA)).json()["url"])
    assert "Звіт" in dl.headers["content-disposition"] or "%D0%97" in dl.headers["content-disposition"]
