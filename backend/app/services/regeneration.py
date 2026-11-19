"""«Регенерувати звіт»: приклад іншого оформлення затвердженого звіту.

Межі (узгоджено):
- переписується лише текст обраних частин (підзаголовки / теорія / хід роботи / висновки);
- порядок розділів, теорії, підзаголовків і пунктів ходу роботи — без змін;
- скріни, схеми, код, команди, числа й результати — з оригіналу, без змін;
- виділення (жирний / курсив / підкреслення) — на вибір; шрифт у перегляді — Times New Roman 14;
- результат лише для перегляду власником на сайті з позначкою «Приклад оформлення · UniPars», без файлу для завантаження.
"""
from __future__ import annotations

import asyncio
import io
import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.config import get_settings
from app.integrations.ai.base import ChatMessage
from app.repositories.store import Row, Store
from app.services.access import Access
from app.services.billing import BillingService

PARTS = {"headings": "підзаголовки", "theory": "теоретичні відомості", "procedure": "хід роботи", "conclusions": "висновки"}
EMPHASIS = {"bold": "жирний", "italic": "курсив", "underline": "підкреслення"}
MAX_SOURCE_CHARS = 60000

SYSTEM = """Ти — редактор навчальних звітів UniPars. Створюєш ПРИКЛАД ІНШОГО ОФОРМЛЕННЯ затвердженого звіту, щоб студенти бачили, як можна інакше сформулювати й подати ту саму роботу.

Суворі правила:
1. Порядок розділів, підзаголовків, теорії та пунктів ходу роботи — ТОЧНО як в оригіналі. Нічого не переставляй, не додавай і не видаляй.
2. Переписуй іншими словами ЛИШЕ частини, перелічені в запиті. Решту залиш дослівно.
3. Числа, вимірювання, результати, формули, команди, вивід програм і код — дослівно, без жодних змін.
4. Маркери [[РИС N]] — це скріни й схеми з оригіналу. Кожен маркер стає блоком {"type":"figure","n":N} на тому самому місці. Не вигадуй нових рисунків, скрінів чи даних.
5. Зміст і правильність — як в оригіналі: жодних нових тверджень, лише інше формулювання.
6. Виділення в тексті: **жирний**, *курсив*, __підкреслення__ — лише дозволені в запиті, помірно, для ключових термінів.

Відповідь — ЛИШЕ JSON без пояснень:
{"title": "...", "sections": [{"heading": "...", "blocks": [
  {"type": "paragraph", "text": "..."} | {"type": "list", "ordered": true, "items": ["..."]} |
  {"type": "code", "text": "..."} | {"type": "table", "rows": [["...", "..."]]} | {"type": "figure", "n": 1, "caption": "..."}
]}]}"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_pdf(data: bytes) -> tuple[str, list[tuple[bytes, str]]]:
    """Текст сторінок із маркерами [[РИС N]] і зображення (скріни/схеми) з оригіналу."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts, images = [], []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
        try:
            for img in page.images:
                raw = img.data
                if len(raw) < 6000:  # іконки й декоративні дрібниці пропускаємо
                    continue
                ext = (img.name.rsplit(".", 1)[-1] or "png").lower()
                images.append((raw, "jpg" if ext in ("jpg", "jpeg") else "png"))
                parts.append(f"[[РИС {len(images)}]]")
        except Exception:
            pass
    return "\n".join(parts), images


def _demo_rewrite(text: str, options: Row) -> Row:
    """Демо-режим без ключа AI: структура з тексту + обрані виділення (для тестів і демонстрації)."""
    emph = options.get("emphasis") or {}
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    title = lines.pop(0) if lines else "Звіт"
    sections, current = [], {"heading": "", "blocks": []}
    for line in lines:
        m = re.fullmatch(r"\[\[РИС (\d+)\]\]", line)
        if m:
            current["blocks"].append({"type": "figure", "n": int(m.group(1)), "caption": f"Рисунок {m.group(1)}"})
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
    return {"title": title, "sections": [x for x in sections if x["blocks"] or x["heading"]], "engine": "demo"}


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
        rewrite = {k: bool((options.get("rewrite") or {}).get(k)) for k in PARTS}
        if not any(rewrite.values()):
            raise HTTPException(400, "Оберіть, що переписати: підзаголовки, теорію, хід роботи або висновки")
        emphasis = {k: bool((options.get("emphasis") or {}).get(k)) for k in EMPHASIS}
        if not self._available():
            raise HTTPException(503, "Генерація тимчасово недоступна. Кошти не списано.")
        if self.s.select("regenerations", [("user_id", "eq", self.a.user_id), ("status", "eq", "running")], limit=1):
            raise HTTPException(429, "Попередня генерація ще триває — зачекайте кілька секунд")
        rid = str(uuid.uuid4())
        billing = BillingService(self.s, self.a.user_id)
        source = billing.consume(rid)  # 402, якщо немає доступних генерацій
        row = self.s.insert("regenerations", {
            "id": rid, "user_id": self.a.user_id, "university_id": sub["university_id"], "submission_id": submission_id,
            "task_id": sub["task_id"], "options": {"rewrite": rewrite, "emphasis": emphasis}, "status": "running",
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
            result = await self._generate(text, row["options"])
            result["figures"] = figures
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
        parts = ", ".join(PARTS[k] for k, v in options["rewrite"].items() if v)
        keep = ", ".join(PARTS[k] for k, v in options["rewrite"].items() if not v) or "—"
        emph = ", ".join(EMPHASIS[k] for k, v in options["emphasis"].items() if v) or "без виділень"
        prompt = (f"Переписати іншими словами: {parts}.\nЗалишити дослівно: {keep}.\nДозволені виділення: {emph}.\n\n"
                  f"Текст звіту (маркери [[РИС N]] — рисунки з оригіналу):\n<<<\n{text[:MAX_SOURCE_CHARS]}\n>>>")
        out = []
        async for chunk in provider.stream(SYSTEM, [ChatMessage(role="user", content=prompt)]):
            out.append(chunk)
        result = _parse_json("".join(out))
        result["engine"] = "ai"
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
