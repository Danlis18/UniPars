"""Тест навантаження: N студентів онлайн одночасно (за замовчуванням 100).

Кожен віртуальний студент поводиться як справжній: відкриває головну й предмети, раз на хвилину
оновлює сповіщення й непрочитані повідомлення, частина сидить у відкритому чаті (оновлення кожні 4 с).
Наприкінці — кількість запитів за секунду, затримки p50/p95/p99 і помилки за маршрутами.

Демо-бекенд (локально, без Supabase — перевіряє сам сервер):
  python scripts/load_test.py --base http://127.0.0.1:8020 --demo --users 100 --seconds 60
Тестове середовище з Supabase (НЕ продакшн): файл із JWT тестових акаунтів (по одному в рядку) і id університету:
  python scripts/load_test.py --base https://<staging-backend> --tokens tokens.txt --university <uuid> --users 100

Ніколи не запускайте на продакшн: тест створює навантаження, як 100 живих людей.
"""
from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import time
from collections import defaultdict

import httpx

stats: dict[str, list[float]] = defaultdict(list)
errors: dict[str, int] = defaultdict(int)


async def call(client: httpx.AsyncClient, name: str, path: str, headers: dict) -> None:
    t = time.perf_counter()
    try:
        r = await client.get(path, headers=headers)
        ok = r.status_code < 500 and r.status_code != 429
    except Exception:
        ok = False
    stats[name].append((time.perf_counter() - t) * 1000)
    if not ok:
        errors[name] += 1


async def student(client: httpx.AsyncClient, headers: dict, until: float, chatty: bool) -> None:
    await asyncio.sleep(random.uniform(0, 10))  # люди заходять не одночасно
    await call(client, "me", "/api/me", headers)
    await call(client, "home", "/api/home", headers)
    last_poll = time.monotonic()
    while time.monotonic() < until:
        action = random.random()
        if chatty:
            await call(client, "chat_poll", "/api/messages", headers)
            await asyncio.sleep(4)
        elif action < 0.4:
            await call(client, "home", "/api/home", headers)
        elif action < 0.7:
            await call(client, "subjects", "/api/subjects", headers)
        elif action < 0.85:
            await call(client, "news", "/api/news?limit=8", headers)
        else:
            await call(client, "my_submissions", "/api/me/submissions", headers)
        if time.monotonic() - last_poll > 60:  # фонові оновлення, як у Layout (раз на хвилину)
            await call(client, "notifications", "/api/notifications", headers)
            await call(client, "unread", "/api/messages/unread", headers)
            last_poll = time.monotonic()
        if not chatty:
            await asyncio.sleep(random.uniform(3, 12))  # людина читає сторінку


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * p))] if s else 0.0


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--users", type=int, default=100)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--chat-share", type=float, default=0.3, help="частка студентів у відкритому чаті")
    ap.add_argument("--demo", action="store_true", help="демо-бекенд: токени demo:<id>")
    ap.add_argument("--tokens", help="файл із JWT тестових акаунтів")
    ap.add_argument("--university", help="X-University-Id (для --tokens)")
    a = ap.parse_args()
    if "railway.app" in a.base and "staging" not in a.base:
        print("Схоже на продакшн — тест навантаження туди запускати не можна.")
        return 1

    async with httpx.AsyncClient(base_url=a.base, timeout=30, limits=httpx.Limits(max_connections=a.users)) as client:
        if a.demo:
            users = (await client.get("/api/demo/users")).json()
            auth = [{"Authorization": f"Bearer demo:{u['id']}", "X-University-Id": u["university_id"]} for u in users]
        else:
            tokens = [t.strip() for t in open(a.tokens, encoding="utf-8") if t.strip()]
            auth = [{"Authorization": f"Bearer {t}", "X-University-Id": a.university} for t in tokens]
        until = time.monotonic() + a.seconds
        started = time.monotonic()
        await asyncio.gather(*(student(client, auth[i % len(auth)], until, i < a.users * a.chat_share) for i in range(a.users)))
        took = time.monotonic() - started

    total = sum(len(v) for v in stats.values())
    errs = sum(errors.values())
    every = [x for v in stats.values() for x in v]
    print(f"\n{a.users} студентів, {took:.0f} с: {total} запитів ({total / took:.1f}/с), помилок {errs} ({100 * errs / max(total, 1):.2f} %)")
    print(f"затримка: p50 {pct(every, .5):.0f} мс · p95 {pct(every, .95):.0f} мс · p99 {pct(every, .99):.0f} мс\n")
    print(f"{'маршрут':<16}{'запитів':>8}{'p50':>8}{'p95':>8}{'макс':>8}{'помилки':>9}")
    for name, v in sorted(stats.items()):
        print(f"{name:<16}{len(v):>8}{statistics.median(v):>8.0f}{pct(v, .95):>8.0f}{max(v):>8.0f}{errors[name]:>9}")
    # критерій для релізу на 100 онлайн: p95 < 800 мс і помилок < 1 %
    ok = pct(every, .95) < 800 and errs / max(total, 1) < 0.01
    print("\nРЕЗУЛЬТАТ: " + ("готово до 100 онлайн" if ok else "НЕ проходить: p95 ≥ 800 мс або помилок ≥ 1 %"))
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
