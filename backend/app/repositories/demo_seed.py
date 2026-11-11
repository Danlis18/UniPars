"""ДЕМОНСТРАЦІЙНІ дані. Університети, люди та новини вигадані й позначені is_demo."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

NS = uuid.UUID("6f1c5c1e-0000-4000-8000-000000000000")


def did(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


UNI_A = did("uni:polytech")
UNI_B = did("uni:classic")

DEMO_USERS = [
    {"id": did("user:olena"), "display_name": "Олена Коваль", "role": "student", "uni": UNI_A, "note": "Студентка КН-21, 2 курс"},
    {"id": did("user:maksym"), "display_name": "Максим Бойко", "role": "student", "uni": UNI_A, "note": "Студент КН-22, 2 курс"},
    {"id": did("user:iryna"), "display_name": "Ірина Ткач", "role": "moderator", "uni": UNI_A, "note": "Модераторка університету"},
    {"id": did("user:andrii"), "display_name": "Андрій Мельник", "role": "admin", "uni": UNI_A, "note": "Адміністратор університету"},
    {"id": did("user:sofiia"), "display_name": "Софія Литвин", "role": "student", "uni": UNI_B, "note": "Студентка іншого університету"},
]


def seed(store) -> None:  # noqa: C901 — лінійний сценарій заповнення
    store.bulk("universities", [
        {"id": UNI_A, "slug": "demo-polytech", "name": "Демо-університет «Політех»", "short_name": "Політех (демо)",
         "is_demo": True, "settings": {"cross_university_sharing": False, "max_upload_mb": 25}},
        {"id": UNI_B, "slug": "demo-classic", "name": "Демо-університет «Класичний»", "short_name": "Класичний (демо)",
         "is_demo": True, "settings": {"cross_university_sharing": False, "max_upload_mb": 25}},
    ])

    fac_it, fac_econ = did("fac:it"), did("fac:econ")
    store.bulk("faculties", [
        {"id": fac_it, "university_id": UNI_A, "name": "Факультет інформаційних технологій"},
        {"id": did("fac:phys"), "university_id": UNI_A, "name": "Фізико-технічний факультет"},
        {"id": fac_econ, "university_id": UNI_B, "name": "Економічний факультет"},
    ])
    prog_cs, prog_se, prog_econ = did("prog:cs"), did("prog:se"), did("prog:econ")
    store.bulk("programs", [
        {"id": prog_cs, "university_id": UNI_A, "faculty_id": fac_it, "name": "Комп'ютерні науки", "code": "122"},
        {"id": prog_se, "university_id": UNI_A, "faculty_id": fac_it, "name": "Інженерія програмного забезпечення", "code": "121"},
        {"id": prog_econ, "university_id": UNI_B, "faculty_id": fac_econ, "name": "Економіка", "code": "051"},
    ])
    g21, g22 = did("grp:kn21"), did("grp:kn22")
    store.bulk("study_groups", [
        {"id": g21, "university_id": UNI_A, "program_id": prog_cs, "name": "КН-21", "course": 2},
        {"id": g22, "university_id": UNI_A, "program_id": prog_cs, "name": "КН-22", "course": 2},
        {"id": did("grp:ipz31"), "university_id": UNI_A, "program_id": prog_se, "name": "ІПЗ-31", "course": 3},
        {"id": did("grp:ek11"), "university_id": UNI_B, "program_id": prog_econ, "name": "ЕК-11", "course": 1},
    ])

    for u in DEMO_USERS:
        store.insert("profiles", {"id": u["id"], "display_name": u["display_name"], "avatar_url": None, "bio": u["note"],
                                  "locale": "uk", "theme": "system", "active_university_id": u["uni"],
                                  "is_platform_admin": False})
    groups = {did("user:olena"): g21, did("user:maksym"): g22}
    for u in DEMO_USERS:
        in_a = u["uni"] == UNI_A
        store.insert("university_memberships", {
            "user_id": u["id"], "university_id": u["uni"], "role": u["role"],
            "faculty_id": fac_it if in_a else fac_econ, "program_id": prog_cs if in_a else prog_econ,
            "group_id": groups.get(u["id"]), "course": 2 if in_a else 1, "onboarded": True,
        })

    subjects_a = [
        ("math", "Вища математика", "Границі, похідні, інтеграли, ряди.", ["Границі", "Похідні", "Інтеграли", "Ряди"], 1, 1),
        ("algo", "Алгоритми і структури даних", "Складність, сортування, графи, динамічне програмування.", ["Складність", "Сортування", "Графи", "Динамічне програмування"], 2, 3),
        ("db", "Бази даних", "Реляційна модель, SQL, нормалізація, транзакції.", ["SQL", "Нормалізація", "Транзакції"], 2, 3),
        ("physics", "Фізика", "Механіка, електрика, оптика.", ["Механіка", "Електрика", "Оптика"], 1, 2),
        ("linalg", "Лінійна алгебра", "Матриці, визначники, власні значення.", ["Матриці", "Визначники", "Власні значення"], 1, 1),
        ("python", "Програмування (Python)", "Основи Python, ООП, робота з файлами.", ["Основи", "ООП", "Файли та винятки"], 1, 2),
    ]
    subjects_b = [
        ("history", "Історія України", "Курс історії від давнини до сучасності.", ["Козацька доба", "XX століття"], 1, 1),
        ("micro", "Мікроекономіка", "Попит, пропозиція, ринкова рівновага.", ["Попит і пропозиція", "Еластичність"], 1, 2),
    ]
    sid, tid = {}, {}
    for uni, items, prog in ((UNI_A, subjects_a, prog_cs), (UNI_B, subjects_b, prog_econ)):
        for slug, name, desc, topics, course, sem in items:
            sid[slug] = did(f"subj:{slug}")
            store.insert("subjects", {"id": sid[slug], "university_id": uni, "slug": slug, "name": name, "description": desc})
            store.insert("subject_programs", {"subject_id": sid[slug], "program_id": prog, "university_id": uni,
                                              "course": course, "semester": sem})
            for i, t in enumerate(topics):
                tid[(slug, t)] = did(f"topic:{slug}:{t}")
                store.insert("topics", {"id": tid[(slug, t)], "university_id": uni, "subject_id": sid[slug], "name": t, "position": i})
    store.insert("subject_programs", {"subject_id": sid["algo"], "program_id": prog_se, "university_id": UNI_A, "course": 2, "semester": 3})

    olena, maksym, iryna, andrii, sofiia = (u["id"] for u in DEMO_USERS)
    store.update("profiles", {"id": olena}, {"telegram": "olena_demo"})
    for a, b in ((olena, iryna), (maksym, iryna), (andrii, iryna), (iryna, andrii), (maksym, olena)):
        store.insert("follows", {"follower_id": a, "following_id": b})
    for s in ("math", "algo", "db"):
        store.insert("subject_subscriptions", {"user_id": olena, "subject_id": sid[s]})
    store.insert("subject_subscriptions", {"user_id": maksym, "subject_id": sid["algo"]})

    def post(key, uni, author, typ, subj, topic, title, body, hours, *, useful=0, visibility="university", group=None,
             status=None, material=None, question=None):
        pid = did(f"post:{key}")
        store.insert("posts", {
            "id": pid, "university_id": uni, "author_id": author, "type": typ, "subject_id": sid[subj],
            "topic_id": tid.get((subj, topic)), "title": title, "body": body, "visibility": visibility,
            "group_id": group, "status": status if typ == "question" else None, "accepted_comment_id": None,
            "is_hidden": False, "is_demo": True, "useful_count": useful, "comment_count": 0,
            "created_at": ago(hours), "updated_at": ago(hours),
        })
        if material:
            store.insert("material_details", {"post_id": pid, "university_id": uni, "link_url": None, "course": None,
                                              "semester": None, "program_id": None, **material})
        if question:
            store.insert("question_details", {"post_id": pid, "university_id": uni, **question})
        return pid

    def comment(pid, uni, author, body, hours, accepted=False, useful=0):
        cid = str(uuid.uuid5(NS, f"c:{pid}:{body[:20]}"))
        store.insert("comments", {"id": cid, "post_id": pid, "university_id": uni, "author_id": author, "parent_id": None,
                                  "body": body, "is_accepted": accepted, "useful_count": useful, "is_hidden": False,
                                  "created_at": ago(hours)})
        p = store.get("posts", id=pid)
        store.update("posts", {"id": pid}, {"comment_count": p["comment_count"] + 1})
        return cid

    p1 = post("integrals", UNI_A, olena, "material", "math", "Інтеграли", "Конспект: інтеграли (лекції 1–6)",
              "Зібрала лекції з невизначених і визначених інтегралів: таблиця основних інтегралів, заміна змінної, "
              "інтегрування частинами.\n\nФормула інтегрування частинами: $\\int u\\,dv = uv - \\int v\\,du$.",
              20, useful=14, material={"kind": "notes", "course": 1, "semester": 1, "program_id": prog_cs})
    comment(p1, UNI_A, maksym, "Дякую! Приклад 14 якраз був на контрольній.", 18)

    p2 = post("dijkstra", UNI_A, maksym, "question", "algo", "Графи", "Чому Дейкстра дає неправильні відстані?",
              "Реалізую алгоритм Дейкстри з `priority_queue`, але для деяких вершин відстань більша, ніж має бути.\n\n"
              "```cpp\nif (!visited[v]) { visited[v] = true; pq.push({d, v}); }\n```",
              10, useful=5, status="solved",
              question={"tried": "Перевірив граф на від'ємні ваги — їх немає.", "unclear_step": "Коли саме позначати вершину відвіданою?"})
    c = comment(p2, UNI_A, iryna, "Позначай `visited` під час **вилучення** з черги, а не під час додавання. "
                                  "Інакше вершина фіксується з першою, а не найкоротшою відстанню.", 9, accepted=True, useful=4)
    store.update("posts", {"id": p2}, {"accepted_comment_id": c})

    post("normalization", UNI_A, iryna, "material", "db", "Нормалізація", "Приклад лабораторної: нормалізація до 3НФ",
         "Покроковий перехід 1НФ → 2НФ → 3НФ для таблиці «Замовлення», функціональні залежності та ER-діаграма. "
         "Використовуйте як орієнтир для власної роботи.", 30, useful=21,
         material={"kind": "lab_example", "course": 2, "semester": 3})

    post("eigen", UNI_A, olena, "question", "linalg", "Власні значення", "Як знайти власні значення матриці 3×3?",
         "Розумію, що треба розв'язати $\\det(A - \\lambda E) = 0$, але плутаюсь, коли виходить кубічне рівняння.",
         3, useful=2, status="open",
         question={"tried": "Розклала визначник за першим рядком.", "unclear_step": "Як підібрати корінь кубічного рівняння?"})

    post("bigO", UNI_A, andrii, "explanation", "algo", "Складність", "Пояснення: O-нотація на пальцях",
         "**O(n)** — час росте пропорційно до кількості елементів. **O(n²)** — для кожного елемента проходимо всі інші "
         "(вкладені цикли). **O(log n)** — щоразу ділимо задачу навпіл (бінарний пошук).", 50, useful=33)

    post("physics-exam", UNI_A, andrii, "material", "physics", "Механіка", "Підготовка до іспиту з фізики: 30 питань",
         "Список питань до іспиту та короткі відповіді на перші 15. Долучайтесь до доповнення решти в коментарях.",
         70, useful=40, material={"kind": "exam_prep", "course": 1, "semester": 2})

    post("kn21-only", UNI_A, olena, "material", "python", "ООП", "Розв'язки практичної №5 (лише для КН-21)",
         "Матеріал для своєї групи: розбір задач з класами та наслідуванням.", 6, visibility="group", group=g21,
         material={"kind": "practical", "course": 1, "semester": 2})

    post("python-link", UNI_A, maksym, "material", "python", "Основи", "Корисне посилання: офіційний туторіал Python",
         "Добре структурований офіційний туторіал — зручно повторювати базу перед контрольною.", 90, useful=9,
         material={"kind": "link", "link_url": "https://docs.python.org/3/tutorial/"})

    post("micro-private", UNI_B, sofiia, "material", "micro", "Еластичність", "Конспект: еластичність попиту",
         "Матеріал університету «Класичний» — не має бути видимим студентам інших університетів.", 12, useful=3,
         material={"kind": "notes", "course": 1, "semester": 2})

    for uni, label in ((UNI_A, "Політех"), (UNI_B, "Класичний")):
        src = did(f"news:{uni}")
        store.insert("news_sources", {"id": src, "university_id": uni, "kind": "manual", "name": f"Оголошення ({label}, демо)",
                                      "url": None, "config": {}, "is_enabled": True, "refresh_minutes": 30,
                                      "last_synced_at": ago(0), "last_error": None})
        items = [
            ("Реєстрація на зимову школу з Data Science", "Безкоштовний інтенсив для студентів 2–4 курсів.", 5),
            ("Опубліковано розклад екзаменаційної сесії", "Остаточний розклад доступний у деканаті.", 28),
            ("Студентський хакатон: 48 годин, 5 треків", "Команди до 4 осіб, реєстрація до кінця місяця.", 60),
            ("Бібліотека подовжує години роботи на час сесії", "Читальна зала працюватиме до 22:00.", 100),
        ]
        for i, (title, summary, h) in enumerate(items):
            store.insert("news_items", {"source_id": src, "university_id": uni, "external_id": f"demo-{i}",
                                        "title": f"[ДЕМО] {title}", "summary": summary, "url": None,
                                        "published_at": ago(h), "fetched_at": ago(0), "is_demo": True})
