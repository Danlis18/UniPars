"""ДЕМОДАНІ для запису відео UniPars (APP_MODE=demo, DEMO_SEED=showcase).

Працює лише з DemoStore у пам'яті локального сервера: зупинка сервера прибирає всі дані.
Профілі вигадані, в інтерфейсі видно лише імена; новини позначені як демонстраційні.
Файли звітів (PDF) читаються з <demo_upload_dir>/showcase_assets, якщо їх згенеровано
scripts/demo_video/make_assets.mjs, інакше підставляється мінімальний PDF.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

NS = uuid.UUID("5c0e5e5e-0000-4000-8000-0000000000aa")


def sid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def ahead(hours: float) -> str:
    # дедлайни на рівну годину — гарніше в кадрі
    d = datetime.now(timezone.utc) + timedelta(hours=hours)
    return d.replace(minute=0, second=0, microsecond=0).isoformat()


UNI = sid("uni")
GROUPS = {n: sid(f"grp:{n}") for n in ("ФЕП-11", "ФЕП-12", "ФЕП-13", "ФЕП-14")}
PEOPLE = [  # (ключ, ім'я, група, роль)
    ("sofiia", "Софія", "ФЕП-11", "student"), ("danylo", "Данило", "ФЕП-12", "student"),
    ("matvii", "Матвєй", "ФЕП-13", "student"), ("danys", "Данис", "ФЕП-14", "student"),
    ("mariia", "Марія", "ФЕП-11", "student"), ("artem", "Артем", "ФЕП-12", "student"),
    ("olena", "Олена", "ФЕП-13", "student"), ("maksym", "Максим", "ФЕП-14", "student"),
    ("admin", "Адміністратор", None, "admin"),
]
U = {k: sid(f"user:{k}") for k, *_ in PEOPLE}

# Для сторінки демовходу (/api/demo/users)
DEMO_USERS = [{"id": U[k], "display_name": name, "role": role, "uni": UNI,
               "note": group or "Модерація факультету"} for k, name, group, role in PEOPLE]

SUBJECTS = [  # (slug, назва як у каталозі ЛНУ, опис)
    ("net", "Комп'ютерні інформаційні мережі та системи", "Linux, мережеві протоколи, маршрутизація, моніторинг і віртуалізація."),
    ("arch", "Архітектура комп'ютерів та комп'ютерна електроніка", "Функціональна організація ЕОМ, логічні елементи, тригери, індикатори."),
    ("prog", "Основи програмування", "Алгоритмізація, мова Сі: типи, умови, цикли, функції, масиви."),
    ("ipz", "Основи інженерії програмного забезпечення", "Вимоги, Git, оцінювання задач, прототипи та вебтехнології."),
    ("math", "Вища математика", "Лінійна алгебра, границі, похідні та інтеграли."),
    ("ukr", "Українська мова (за професійним спрямуванням)", "Норми й стилі професійного спілкування, ділові документи."),
]

NET = ["Робота з робочим середовищем Linux", "Мережеві протоколи", "Безпека мережі", "Автоматизація (CI/CD)",
       "Автоматизація (CI/CD), частина 2: Jenkins", "Віртуалізація", "Моніторинг мереж", "Стек протоколів",
       "Маршрутизація: ping і traceroute", "Лінії зв'язку"]
ARCH = ["Функціональна організація комп'ютера", "Вольтамперні характеристики діодів і транзисторів",
        "Операційні підсилювачі", "Алгебра логіки та базові логічні елементи", "Тригери",
        "Регістри пам'яті та зсуву", "Семисегментні індикатори U2 та U3"]
PROG = ["Найпростіші алгоритми", "Мова Scratch", "Сі: компіляція, введення й виведення", "Типи змінних і операції",
        "Умовні оператори", "Цикли", "Функції", "Масиви"]
IPZ = ["Оцінка кар'єрних очікувань", "Резюме та презентація", "Вимоги в Trello", "Перші зміни в Git",
       "Planning Poker", "Введення й виведення в Python", "ШІ-асистенти в розробці", "Прототип вебсторінки",
       "Обробка подій у HTML"]

NET9_CONDITION = """**Мета:** навчитися перевіряти досяжність вузлів і досліджувати маршрут пакетів у мережі.

**Хід роботи**
1. Перевірте доступність `lnu.edu.ua` та `8.8.8.8` командою `ping` (по 10 запитів). Запишіть середній час і втрати.
2. Побудуйте маршрут до `8.8.8.8` командою `traceroute` (у Windows — `tracert`).
3. Для кожного переходу вкажіть адресу вузла й затримку. Поясніть рядки з `* * *`.
4. Порівняйте маршрути з домашньої мережі та мережі університету.

**Звіт:** скріни команд, таблиця переходів, висновки (5–7 речень)."""

ARCH7_CONDITION = """**Мета:** вивчити роботу семисегментних індикаторів і відображення шістнадцяткових чисел.

1. Зберіть схему з двома індикаторами U2 та U3 і дешифраторами.
2. Подайте на входи коди від `00₁₆` до `FF₁₆`, зафіксуйте покази.
3. Визначте, який індикатор показує старшу цифру.

**Звіт:** схема, таблиця кодів, висновки."""


def seed(store) -> None:  # noqa: C901 — лінійний сценарій
    from app.core.config import get_settings
    from app.repositories.storage import LocalStorage

    s = get_settings()
    storage = LocalStorage(s.demo_upload_dir, s.file_link_secret)
    assets = s.demo_upload_dir / "showcase_assets"

    def asset(name: str) -> bytes:
        f = assets / name
        if f.exists():
            return f.read_bytes()
        from app.repositories.demo_seed import DEMO_PDF
        return DEMO_PDF

    store.insert("universities", {"id": UNI, "slug": "lnu", "name": "Львівський національний університет імені Івана Франка",
                                  "short_name": "ЛНУ ім. Франка", "is_demo": False,
                                  "settings": {"cross_university_sharing": False, "max_upload_mb": 25}})
    fac, prog = sid("fac"), sid("prog:f2")
    store.insert("faculties", {"id": fac, "university_id": UNI, "name": "Факультет електроніки та комп'ютерних технологій"})
    store.insert("programs", {"id": prog, "university_id": UNI, "faculty_id": fac, "name": "Інженерія програмного забезпечення", "code": "F2"})
    for name, gid in GROUPS.items():
        store.insert("study_groups", {"id": gid, "university_id": UNI, "program_id": prog, "name": name, "course": 1})

    year = datetime.now(timezone.utc).year if datetime.now(timezone.utc).month >= 9 else datetime.now(timezone.utc).year - 1
    for k, name, group, role in PEOPLE:
        store.insert("profiles", {"id": U[k], "display_name": name, "avatar_url": None, "bio": "", "locale": "uk", "theme": "dark",
                                  "active_university_id": UNI, "is_platform_admin": False, "is_bot": False, "created_at": ago(24 * 70)})
        store.insert("university_memberships", {"user_id": U[k], "university_id": UNI, "role": role, "faculty_id": fac,
                                                "program_id": prog, "group_id": GROUPS.get(group), "course": 1,
                                                "entry_year": year, "onboarded": True})

    subj = {}
    for slug, name, desc in SUBJECTS:
        subj[slug] = sid(f"subj:{slug}")
        store.insert("subjects", {"id": subj[slug], "university_id": UNI, "slug": slug, "name": name, "description": desc})
        store.insert("subject_programs", {"subject_id": subj[slug], "program_id": prog, "university_id": UNI, "course": 1,
                                          "semester": 1, "semesters": [1, 2], "courses": [1], "is_elective": False})
    for k, *_ in PEOPLE:
        for slug in subj:
            store.insert("subject_subscriptions", {"user_id": U[k], "subject_id": subj[slug]})
    for a, b in (("danylo", "sofiia"), ("sofiia", "danylo"), ("matvii", "danys"), ("olena", "sofiia"), ("artem", "danylo")):
        store.insert("follows", {"follower_id": U[a], "following_id": U[b]})

    # ---------- Завдання ----------
    tid = {}

    def task(slug, kind, n, title, desc="", deadline_h=None):
        key = f"{slug}:{kind}:{n}"
        tid[key] = sid(f"task:{key}")
        store.insert("tasks", {"id": tid[key], "university_id": UNI, "subject_id": subj[slug], "kind": kind, "number": n,
                               "title": title, "description": desc, "deadline_at": ahead(deadline_h) if deadline_h else None,
                               "created_by": U["admin"], "created_at": ago(24 * 40), "updated_at": ago(24 * 40)})
        return tid[key]

    for i, t in enumerate(NET, 1):
        task("net", "lab", i, t, NET9_CONDITION if i == 9 else "", 50 if i == 9 else None)
    for i, t in enumerate(ARCH, 1):
        task("arch", "lab", i, t, ARCH7_CONDITION if i == 7 else "", 98 if i == 7 else None)
    for i, t in enumerate(PROG, 1):
        task("prog", "lab", i, t, "", 146 if i == 8 else None)
    for i, t in enumerate(IPZ, 1):
        task("ipz", "lab", i, t, "", 290 if i == 9 else None)
    task("net", "exam", 1, "Екзамен", "Теоретичні питання та практичне завдання з маршрутизації.")
    task("arch", "module", 1, "Модульна контрольна №1", "Логічні елементи, тригери, регістри.")
    for i, t in enumerate(["Матриці та визначники", "Системи лінійних рівнянь", "Границі функцій"], 1):
        task("math", "practical", i, t)
    task("math", "module", 1, "Модульна контрольна №1", "Матриці, СЛАР, границі.", 218)
    task("ukr", "practical", 1, "Норми професійного мовлення")

    # Методичка до ЛР9 (файл умови)
    data = asset("metodychka-lr9.pdf")
    path = f"{UNI}/tasks/{tid['net:lab:9']}/metodychka.pdf"
    storage.put(path, data, "application/pdf")
    store.insert("task_files", {"id": sid("tf:net9"), "task_id": tid["net:lab:9"], "university_id": UNI, "uploader_id": U["admin"],
                                "storage_path": path, "file_name": "Методичні вказівки ЛР9.pdf", "mime_type": "application/pdf",
                                "size_bytes": len(data), "created_at": ago(24 * 30)})

    # Схвалені приклади
    def example(key, task_key, author, file, title, hours, downloads):
        data = asset(file)
        path = f"{UNI}/submissions/{tid[task_key]}/{key}.pdf"
        storage.put(path, data, "application/pdf")
        store.insert("submissions", {
            "id": sid(f"sub:{key}"), "task_id": tid[task_key], "university_id": UNI, "author_id": U[author], "comment": "",
            "status": "approved", "review_note": None, "reviewed_by": U["admin"], "reviewed_at": ago(hours - 2),
            "published_at": ago(hours - 2), "storage_path": path, "file_name": title, "mime_type": "application/pdf",
            "size_bytes": len(data), "source_attachment_id": None, "download_count": downloads, "is_anonymous": False,
            "created_at": ago(hours), "updated_at": ago(hours)})

    example("net9-sofiia", "net:lab:9", "sofiia", "report-net9.pdf", "ЛР9_Маршрутизація_ping_traceroute.pdf", 30, 41)
    example("arch7-danys", "arch:lab:7", "danys", "report-arch7.pdf", "ЛР7_Індикатори_U2_U3.pdf", 52, 33)
    example("net8-artem", "net:lab:8", "artem", "report-net8.pdf", "ЛР8_Стек_протоколів.pdf", 75, 27)
    example("prog7-mariia", "prog:lab:7", "mariia", "report-prog7.pdf", "ЛР7_Функції_Сі.pdf", 96, 22)
    example("ipz8-maksym", "ipz:lab:8", "maksym", "report-ipz8.pdf", "ЛР8_Прототип_вебсторінки.pdf", 120, 15)
    example("arch6-olena", "arch:lab:6", "olena", "report-arch6.pdf", "ЛР6_Регістри.pdf", 140, 12)

    # ---------- Форум ----------
    def thread(key, slug, task_key, author, title, body, hours, replies):
        pid = sid(f"post:{key}")
        store.insert("posts", {"id": pid, "university_id": UNI, "author_id": U[author], "type": "question", "subject_id": subj[slug],
                               "topic_id": None, "task_id": tid.get(task_key), "title": title, "body": body,
                               "visibility": "university", "group_id": None, "status": "open", "accepted_comment_id": None,
                               "is_hidden": False, "is_demo": False, "useful_count": len(replies), "comment_count": 0,
                               "created_at": ago(hours), "updated_at": ago(hours)})
        store.insert("question_details", {"post_id": pid, "university_id": UNI, "tried": "", "unclear_step": ""})
        for i, (who, text, h) in enumerate(replies):
            store.insert("comments", {"id": sid(f"c:{key}:{i}"), "post_id": pid, "university_id": UNI, "author_id": U[who],
                                      "parent_id": None, "body": text, "is_accepted": False, "useful_count": 0,
                                      "is_hidden": False, "created_at": ago(h)})
        store.update("posts", {"id": pid}, {"comment_count": len(replies)})

    thread("arch7", "arch", "arch:lab:7", "matvii", "Лабораторна №7 — що показують U2 та U3?",
           "На схемі бачу дві п'ятірки. Чому їх читаємо як 55?", 20,
           [("danys", "Кожен індикатор показує одну шістнадцяткову цифру. Разом це 55₁₆.", 19),
            ("olena", "Я ще підписала в поясненні, який індикатор показує старшу цифру. Так легше читати схему.", 17)])
    thread("prog-scanf", "prog", "prog:lab:3", "artem", "Чому scanf пропускає введення після числа?",
           "Після `scanf(\"%d\")` наступний `fgets` одразу повертає порожній рядок.", 44,
           [("mariia", "У буфері лишається `\\n`. Додай `getchar()` після `scanf` або читай усе через `fgets`.", 42)])
    thread("net-jenkins", "net", "net:lab:5", "maksym", "Jenkins не бачить агента — що перевірити?",
           "Агент у статусі offline, хоча контейнер запущений.", 70,
           [("sofiia", "Перевір порт 50000 і секрет агента в команді запуску — у мене була зайва лапка.", 66)])

    # ---------- Новини (демонстраційні) ----------
    src = sid("news")
    store.insert("news_sources", {"id": src, "university_id": UNI, "kind": "manual", "name": "Факультет електроніки (демо)",
                                  "url": None, "config": {}, "is_enabled": True, "refresh_minutes": 30,
                                  "last_synced_at": ago(0.2), "last_error": None})
    for i, (title, summary, h) in enumerate([
        ("Зимова школа DevOps для першокурсників", "Безкоштовний інтенсив: Linux, Git, Docker і CI/CD. Реєстрація до 1 грудня, кількість місць обмежена.", 3),
        ("Оновлено розклад консультацій перед сесією", "Консультації з мереж і архітектури комп'ютерів перенесено на четвер, ауд. 214.", 26),
        ("Хакатон факультету: 48 годин, 4 треки", "Команди до 4 осіб, менторство від випускників, фінал у грудні.", 55),
    ]):
        store.insert("news_items", {"source_id": src, "university_id": UNI, "external_id": f"showcase-{i}", "title": title,
                                    "summary": summary, "url": None, "published_at": ago(h), "fetched_at": ago(0.2), "is_demo": True})
