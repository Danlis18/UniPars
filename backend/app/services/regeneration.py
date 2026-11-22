"""«Регенерувати звіт»: приклад іншого оформлення затвердженого звіту.

Межі (узгоджено):
- підзаголовки, теорія й хід роботи — ДОСЛІВНО, без переписування; висновки — тими самими думками іншими словами;
- порядок розділів, теорії, підзаголовків і пунктів ходу роботи — без змін;
- скріни, схеми, код, команди, числа й результати — з оригіналу, без змін;
- стилізація випадкова при кожній генерації: виділення ключових термінів (жирний / курсив / підкреслення)
  і стиль підзаголовків; шрифт у перегляді — Times New Roman 14;
- результат лише для перегляду власником на сайті з позначкою «Приклад оформлення · UniPars», без файлу для завантаження.
"""
from __future__ import annotations

import asyncio
import io
import json
import random
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.integrations.ai.base import ChatMessage
from app.repositories.store import Row, Store
from app.services.access import Access
from app.services.billing import BillingService

EMPHASIS = {"bold": "жирний", "italic": "курсив", "underline": "підкреслення"}
HEADING_STYLES = ("bold", "bold-caps", "bold-underline", "bold-italic")
DENSITY = {"light": "2–3 ключові терміни на розділ", "medium": "4–6 ключових термінів і понять на розділ",
           "rich": "ключові терміни, назви команд у тексті та головна думка кожного абзацу"}


def random_style() -> Row:
    """Випадкова стилізація: які види виділення, наскільки густо, стиль підзаголовків."""
    rng = random.SystemRandom()
    kinds = [k for k in EMPHASIS if rng.random() < 0.6] or [rng.choice(list(EMPHASIS))]
    return {"emphasis": kinds, "density": rng.choice(list(DENSITY)), "heading": rng.choice(HEADING_STYLES),
            "seed": rng.randrange(1, 10**6)}
MAX_SOURCE_CHARS = 60000

SYSTEM = """Ти — редактор навчальних звітів UniPars. Створюєш ПРИКЛАД ІНШОГО ОФОРМЛЕННЯ затвердженого звіту, щоб студенти бачили, як можна інакше сформулювати й подати ту саму роботу.

Суворі правила:
1. Порядок розділів, підзаголовків, теорії та пунктів ходу роботи — ТОЧНО як в оригіналі. Нічого не переставляй, не додавай і не видаляй.
2. Підзаголовки, теоретичні відомості й хід роботи — СЛОВО В СЛОВО як в оригіналі. Не перефразовуй, не скорочуй, не доповнюй.
   Іншими словами можна сформулювати ЛИШЕ висновки (ті самі думки, ті самі числа).
3. Числа, вимірювання, результати, формули, команди, вивід програм і код — дослівно, без жодних змін.
4. Нумерацію пунктів зберігай: якщо список переривається рисунком, наступний список продовжує номер через "start".
5. Маркери [[РИС N]] — це скріни й схеми з оригіналу. Кожен маркер стає блоком {"type":"figure","n":N} на тому самому місці, БЕЗ підпису. Не вигадуй нових рисунків, скрінів чи даних.
6. Зміст і правильність — як в оригіналі: жодних нових тверджень, лише інше формулювання.
7. Різниця з оригіналом — у стилізації: виділяй ключові терміни лише дозволеними в запиті видами
   (**жирний**, *курсив*, __підкреслення__) і з указаною густотою. Сам текст при цьому не змінюй.

Відповідь — ЛИШЕ JSON без пояснень:
{"title": "...", "sections": [{"heading": "...", "blocks": [
  {"type": "paragraph", "text": "..."} | {"type": "list", "ordered": true, "start": 1, "items": ["..."]} |
  {"type": "code", "text": "..."} | {"type": "table", "rows": [["...", "..."]]} | {"type": "figure", "n": 1}
]}]}"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _page_items(page) -> tuple[list[tuple[float, str]], list[tuple[float, str]]]:
    """Рядки тексту й картинки сторінки з вертикальною позицією (y у PDF росте догори)."""
    names = {im.name.rsplit(".", 1)[0] for im in page.images}
    pieces, imgs = [], []

    def on_text(text, cm, tm, _font, _size):
        if text:
            pieces.append((cm[3] * tm[5] + cm[5], text))

    def on_op(op, args, cm, _tm):
        if op == b"Do" and args and str(args[0]).lstrip("/") in names:
            imgs.append((cm[5] + cm[3], str(args[0]).lstrip("/")))  # верх картинки

    page.extract_text(visitor_text=on_text, visitor_operand_before=on_op)
    # шматки з однаковою висотою (±3 pt) — один рядок; Word пише слова окремо, тому склеюємо
    lines: list[list] = []
    for y, t in pieces:
        t = t.replace("\n", " ")
        for ln in lines:
            if abs(ln[0] - y) <= 3:
                ln[1] += t
                break
        else:
            lines.append([y, t])
    text_lines = [(y, re.sub(r"\s{2,}", " ", t).strip()) for y, t in lines if t.strip()]
    return text_lines, imgs


def extract_pdf(data: bytes) -> tuple[str, list[tuple[bytes, str]]]:
    """Текст із маркерами [[РИС N]] рівно там, де картинки стоять на сторінці, і самі картинки з оригіналу.
    Порядок — за положенням на сторінці (зверху вниз), а не за порядком запису в PDF:
    Word спершу пише весь текст, а потім картинки."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts, images = [], []
    for page in reader.pages:
        by_name = {im.name.rsplit(".", 1)[0]: im for im in page.images}
        try:
            text_lines, imgs = _page_items(page)
        except Exception:
            text_lines, imgs = [], []
        if not text_lines:  # запасний шлях для нестандартних PDF
            raw = page.extract_text(extraction_mode="layout") or ""
            parts.extend(re.sub(r"\s{2,}", " ", ln.strip()) for ln in raw.splitlines() if ln.strip())
            imgs = [(-i, n) for i, n in enumerate(by_name)]
            text_lines = []
        seq = [(y, 0, i, ("t", t)) for i, (y, t) in enumerate(text_lines)]
        seq += [(y, 1, i, ("img", n)) for i, (y, n) in enumerate(imgs)]
        for _y, _k, _i, (kind, val) in sorted(seq, key=lambda s: (-s[0], s[1], s[2])):
            if kind == "t":
                parts.append(val)
                continue
            img = by_name.get(val)
            try:
                raw = img.data if img else b""
            except Exception:
                raw = b""
            if len(raw) < 6000:  # іконки й декоративні дрібниці пропускаємо
                continue
            ext = (img.name.rsplit(".", 1)[-1] or "png").lower()
            images.append((raw, "jpg" if ext in ("jpg", "jpeg") else "png"))
            parts.append(f"[[РИС {len(images)}]]")
    return "\n".join(parts), images


PLACEHOLDER_NAME = "Данило Галицький"  # ім'я на титулці прикладу замість справжнього автора
_BODY_START = re.compile(r"^(Мета|Тема|Хід роботи|Завдання|Теоретичн|Вступ)\b", re.I)
_TOP_SPLIT = re.compile(r"\s+(?=(?:Львівський|Національний|Факультет|Кафедра|Інститут)\b)")
_PERSON = re.compile(r"^[А-ЯІЇЄҐ][а-яіїєґ'’-]+\s+[А-ЯІЇЄҐ][а-яіїєґ'’-]+(\s+[А-ЯІЇЄҐ][а-яіїєґ'’-]+)?$")


def parse_title_page(text: str) -> tuple[Row | None, str]:
    """Титулка — як в оригіналі (шапка, назва роботи, «Виконав/Викладач», місто й рік), ім'я студента → заглушка.
    Розбираємо кодом, а не ШІ: так рядки не переставляються і нічого не губиться."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    end = next((i for i, l in enumerate(lines) if _BODY_START.match(l)), None)
    head = lines[:end] if end else []
    if not head or not any(l.startswith(("Виконав", "Виконала", "Звіт")) for l in head):
        return None, text
    rest = "\n".join(lines[end:])
    i_report = next((i for i, l in enumerate(head) if l.startswith("Звіт")), 0)
    i_author = next((i for i, l in enumerate(head) if l.startswith(("Виконав", "Виконала"))), len(head))
    i_city = next((i for i in range(len(head) - 1, i_author, -1) if re.search(r"\b(19|20)\d{2}\b", head[i])), len(head))
    # шапку PDF часто переносить посеред назви — збираємо її знову по рядку на установу
    top = [x.strip() for x in _TOP_SPLIT.split(" ".join(head[:i_report])) if x.strip()]
    center = head[i_report:i_author]
    right, replaced, in_author = [], False, False
    for l in head[i_author:i_city]:
        if l.startswith(("Виконав", "Виконала")):
            in_author = True
        elif l.startswith(("Викладач", "Перевірив", "Перевірила", "Керівник")):
            in_author = False
        if in_author and not replaced and _PERSON.match(l):
            l, replaced = PLACEHOLDER_NAME, True
        right.append(l)
    return {"top": top, "center": center, "right": right, "bottom": head[i_city:]}, rest


def _demo_rewrite(text: str, options: Row) -> Row:
    """Демо-режим без ключа AI: структура з тексту + обрані виділення (для тестів і демонстрації)."""
    emph = {k: True for k in (options.get("style") or {}).get("emphasis", [])}
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title = lines.pop(0) if lines else "Звіт"
    sections, current = [], {"heading": "", "blocks": []}
    for line in lines:
        m = re.fullmatch(r"\[\[РИС (\d+)\]\]", line)
        if m:
            current["blocks"].append({"type": "figure", "n": int(m.group(1))})
        elif len(line) < 60 and not line.endswith((".", ",", ";")) and line[:1].isupper():
            if current["blocks"]:
                sections.append(current)
            current = {"heading": line, "blocks": []}
        else:
            words = line.split(" ", 1)
            if emph.get("bold") and len(words) == 2:
                line = f"**{words[0]}** {words[1]}"
            current["blocks"].append({"type": "paragraph", "text": line})
    sections.append(current)
    return {"title": title, "sections": [x for x in sections if x["blocks"] or x["heading"]], "engine": "demo",
            "heading_style": (options.get("style") or {}).get("heading", "bold")}


def _parse_json(text: str) -> Row:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    start, end = t.find("{"), t.rfind("}")
    data = json.loads(t[start:end + 1])
    if not isinstance(data.get("sections"), list) or not data["sections"]:
        raise ValueError("порожній результат")
    return data


class RegenerationService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    def _available(self) -> bool:
        return get_settings().ai_enabled or get_settings().is_demo

    def start(self, submission_id: str, options: Row, storage, background) -> Row:
        sub = self.s.get("submissions", id=submission_id)
        if not sub or sub["status"] != "approved" or not (self.a.membership(sub["university_id"]) or self.a.is_platform_admin):
            raise HTTPException(404, "Звіт не знайдено")
        if sub["mime_type"] != "application/pdf":
            raise HTTPException(415, "Регенерація доступна для звітів у PDF")
        style = random_style()  # налаштувань не обирають: стиль щоразу випадковий
        if not self._available():
            raise HTTPException(503, "Генерація тимчасово недоступна. Кошти не списано.")
        if self.s.select("regenerations", [("user_id", "eq", self.a.user_id), ("status", "eq", "running")], limit=1):
            raise HTTPException(429, "Попередня генерація ще триває — зачекайте кілька секунд")
        rid = str(uuid.uuid4())
        billing = BillingService(self.s, self.a.user_id)
        source = billing.consume(rid)  # 402, якщо немає доступних генерацій
        row = self.s.insert("regenerations", {
            "id": rid, "user_id": self.a.user_id, "university_id": sub["university_id"], "submission_id": submission_id,
            "task_id": sub["task_id"], "options": {"style": style}, "status": "running",
            "result": None, "error": None, "charged_from": source, "created_at": _now(), "completed_at": None})
        background.add_task(self._run, row, sub, storage)  # виконується після відповіді
        return self._out(row)

    async def _run(self, row: Row, sub: Row, storage) -> None:
        try:
            data = await asyncio.to_thread(storage.get, sub["storage_path"])
            text, images = await asyncio.to_thread(extract_pdf, data)
            if not text.strip():
                raise ValueError("У PDF немає тексту (можливо, це скани) — регенерувати нема чого")
            figures = []
            for i, (raw, ext) in enumerate(images, 1):
                path = f"{row['university_id']}/regenerations/{row['id']}/fig{i}.{ext}"
                await asyncio.to_thread(storage.put, path, raw, "image/jpeg" if ext == "jpg" else "image/png")
                figures.append(path)
            title_page, body = parse_title_page(text)
            result = await self._generate(body, row["options"])
            result["figures"] = figures
            if title_page:
                result["title_page"] = title_page
            self.s.update("regenerations", {"id": row["id"]}, {"status": "done", "result": result, "completed_at": _now()})
        except Exception as e:  # будь-яка помилка → генерацію повертаємо
            msg = str(e)[:300] if isinstance(e, ValueError) else "Не вдалося згенерувати. Генерацію повернуто на баланс."
            self.s.update("regenerations", {"id": row["id"]}, {"status": "failed", "error": msg, "completed_at": _now()})
            BillingService(self.s, row["user_id"]).refund(row["charged_from"], row["id"])

    async def _generate(self, text: str, options: Row) -> Row:
        from app.integrations.ai.factory import get_provider

        provider = get_provider()
        if provider is None:  # демо-режим без ключа
            return _demo_rewrite(text, options)
        st = options["style"]
        emph = ", ".join(EMPHASIS[k] for k in st["emphasis"])
        prompt = (f"Дослівно: підзаголовки, теорія, хід роботи. Іншими словами: лише висновки.\n"
                  f"Дозволені виділення: {emph}. Густота: {DENSITY[st['density']]}. Варіант стилізації №{st['seed']}.\n\n"
                  f"Текст звіту (маркери [[РИС N]] — рисунки з оригіналу):\n<<<\n{text[:MAX_SOURCE_CHARS]}\n>>>")
        out = []
        async for chunk in provider.stream(SYSTEM, [ChatMessage(role="user", content=prompt)]):
            out.append(chunk)
        result = _parse_json("".join(out))
        result["engine"] = "ai"
        result["heading_style"] = st["heading"]
        return result

    # ---------- Перегляд ----------
    def _out(self, r: Row, storage=None) -> Row:
        out = {k: r.get(k) for k in ("id", "status", "error", "options", "created_at", "completed_at", "submission_id", "task_id")}
        if r["status"] == "done" and r.get("result"):
            res = dict(r["result"])
            figs = res.pop("figures", [])
            if storage is not None:
                res["figure_urls"] = [storage.signed_url(p, f"fig{i}") for i, p in enumerate(figs, 1)]
            out["result"] = res
        return out

    def get(self, regeneration_id: str, storage) -> Row:
        r = self.s.get("regenerations", id=regeneration_id)
        if not r or r["user_id"] != self.a.user_id:  # бачить лише той, хто оплатив
            raise HTTPException(404, "Не знайдено")
        out = self._out(r, storage)
        t = self.s.get("tasks", id=r["task_id"]) or {}
        out["task"] = {"id": t.get("id"), "kind": t.get("kind"), "number": t.get("number"), "title": t.get("title")}
        return out

    def mine(self) -> list[Row]:
        rows = self.s.select("regenerations", [("user_id", "eq", self.a.user_id)], order="created_at", desc=True, limit=50)
        tasks = {t["id"]: t for t in self.s.select("tasks", [("id", "in", list({r["task_id"] for r in rows}))])} if rows else {}
        return [{**self._out(r), "task": {k: tasks.get(r["task_id"], {}).get(k) for k in ("id", "kind", "number", "title")}} for r in rows]
