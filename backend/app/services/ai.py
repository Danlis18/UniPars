"""AI-помічник: приватні діалоги, контекст із матеріалів, потокові відповіді."""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import HTTPException

from app.integrations.ai.base import AIProvider, AIRefused, AIUnavailable, ChatMessage
from app.repositories.store import Row, Store
from app.services.access import Access

SYSTEM_PROMPT = """Ти — AI-помічник UniPars, платформи взаємодопомоги студентів.
Твоя мета — щоб студент зрозумів матеріал, а не лише отримав відповідь.
- Пояснюй простими словами, крок за кроком; показуй проміжні кроки розв'язання.
- Перевіряючи розв'язання чи код, спершу знайди конкретну помилку, потім поясни, чому це помилка і як виправити.
- Для формул використовуй LaTeX ($...$ або $$...$$), для коду — блоки ```мова.
- Якщо до запиту додано навчальний матеріал, спирайся на нього і зазначай, коли виходиш за його межі.
- Відповідай мовою користувача (за замовчуванням — українською). Будь лаконічним, без зайвих вступів."""

MAX_CONTEXT_CHARS = 12000
HISTORY_MESSAGES = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RateLimiter:
    def __init__(self) -> None:
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, user_id: str, per_minute: int) -> None:
        q = self.hits[user_id]
        now = time.monotonic()
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= per_minute:
            raise HTTPException(429, "Забагато запитів до AI. Зачекайте хвилину.")
        q.append(now)


rate_limiter = RateLimiter()


class AIService:
    def __init__(self, store: Store, access: Access) -> None:
        self.s = store
        self.a = access

    # ---------- Діалоги (лише власні) ----------
    def _own(self, conversation_id: str) -> Row:
        c = self.s.get("ai_conversations", id=conversation_id)
        if not c or c["user_id"] != self.a.user_id:
            raise HTTPException(404, "Діалог не знайдено")
        return c

    def list(self) -> list[Row]:
        return self.s.select("ai_conversations", [("user_id", "eq", self.a.user_id)], order="updated_at", desc=True, limit=100)

    def create(self, university_id: str | None, title: str | None) -> Row:
        if university_id and university_id not in self.a.memberships:
            university_id = None
        return self.s.insert("ai_conversations", {"user_id": self.a.user_id, "university_id": university_id,
                                                  "title": (title or "Новий діалог")[:120], "created_at": _now(), "updated_at": _now()})

    def rename(self, conversation_id: str, title: str) -> Row:
        self._own(conversation_id)
        return self.s.update("ai_conversations", {"id": conversation_id, "user_id": self.a.user_id}, {"title": title})[0]

    def delete(self, conversation_id: str) -> None:
        self._own(conversation_id)
        self.s.delete("ai_messages", {"conversation_id": conversation_id})
        self.s.delete("ai_conversations", {"id": conversation_id, "user_id": self.a.user_id})

    def messages(self, conversation_id: str) -> list[Row]:
        self._own(conversation_id)
        return self.s.select("ai_messages", [("conversation_id", "eq", conversation_id)], order="created_at")

    # ---------- Контекст із матеріалу ----------
    def context_for(self, post_id: str) -> Row:
        """Що саме піде в AI. Доступ перевіряється як для звичайного перегляду допису."""
        post = self.a.get_post(post_id)
        subject = self.s.get("subjects", id=post["subject_id"]) or {}
        topic = self.s.get("topics", id=post["topic_id"]) if post.get("topic_id") else None
        parts = [f"Предмет: {subject.get('name', '')}" + (f"; тема: {topic['name']}" if topic else ""),
                 f"Заголовок: {post['title']}", "", post["body"]]
        q = self.s.get("question_details", post_id=post_id)
        if q:
            if q.get("tried"):
                parts += ["", f"Що вже пробував студент: {q['tried']}"]
            if q.get("unclear_step"):
                parts += [f"Який крок незрозумілий: {q['unclear_step']}"]
        md = self.s.get("material_details", post_id=post_id)
        if md and md.get("link_url"):
            parts += ["", f"Посилання (вміст не завантажено): {md['link_url']}"]
        text = "\n".join(parts).strip()
        truncated = len(text) > MAX_CONTEXT_CHARS
        notes = []
        for att in self.s.select("attachments", [("post_id", "eq", post_id)]):
            notes.append(f"Файл «{att['file_name']}»: витягування тексту з файлів ще не підтримується, AI бачить лише опис допису.")
        if truncated:
            notes.append(f"Текст обрізано до {MAX_CONTEXT_CHARS} символів.")
        return {"post_id": post_id, "title": post["title"], "text": text[:MAX_CONTEXT_CHARS], "notes": notes,
                "type": post["type"]}

    # ---------- Генерація ----------
    async def stream_reply(self, provider: AIProvider | None, conversation_id: str, content: str,
                           context_post_id: str | None, retry: bool, per_minute: int) -> AsyncIterator[str]:
        conv = self._own(conversation_id)
        if provider is None:
            raise HTTPException(503, "AI ще не підключено")
        rate_limiter.check(self.a.user_id, per_minute)

        history = self.messages(conversation_id)
        if retry:
            # Прибираємо невдалу відповідь і повторюємо останнє запитання
            while history and history[-1]["role"] == "assistant":
                self.s.delete("ai_messages", {"id": history.pop()["id"]})
            if not history:
                raise HTTPException(400, "Немає повідомлення для повтору")
        else:
            if not content.strip():
                raise HTTPException(400, "Порожнє повідомлення")
            stored = content
            if context_post_id:
                ctx = self.context_for(context_post_id)  # перевірка доступу
                stored = f"{content}\n\n---\nМатеріал «{ctx['title']}»:\n{ctx['text']}"
            msg = self.s.insert("ai_messages", {"conversation_id": conversation_id, "role": "user", "content": stored,
                                                "context_post_id": context_post_id, "status": "complete", "created_at": _now()})
            history.append(msg)
            if conv["title"] == "Новий діалог":
                self.s.update("ai_conversations", {"id": conversation_id}, {"title": content.strip().split("\n")[0][:60] or "Діалог"})

        chat = [ChatMessage(m["role"], m["content"]) for m in history[-HISTORY_MESSAGES:] if m["status"] != "error" or m["role"] == "user"]
        # API вимагає, щоб перше повідомлення було від користувача
        while chat and chat[0].role != "user":
            chat.pop(0)

        async def gen() -> AsyncIterator[str]:
            answer, status, error = "", "complete", None
            try:
                async for delta in provider.stream(SYSTEM_PROMPT, chat):
                    answer += delta
                    yield _sse("delta", {"text": delta})
            except AIRefused:
                status, error = "error", "AI не може допомогти з цим запитом."
            except AIUnavailable as e:
                status, error = "error", str(e)
            except Exception:  # клієнт зупинив генерацію або обрив з'єднання
                status = "partial"
                raise
            finally:
                if answer or status == "error":
                    self.s.insert("ai_messages", {"conversation_id": conversation_id, "role": "assistant",
                                                  "content": answer or (error or ""), "context_post_id": None,
                                                  "status": status if status != "complete" or answer else "error",
                                                  "created_at": _now()})
                self.s.update("ai_conversations", {"id": conversation_id}, {"updated_at": _now()})
            if error:
                yield _sse("error", {"error": error})
            else:
                yield _sse("done", {})

        return gen()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
