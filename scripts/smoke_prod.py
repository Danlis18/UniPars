"""Перевірка бойового сайту UniPars (без входу в акаунти, без зміни даних).

    python scripts/smoke_prod.py
    python scripts/smoke_prod.py --frontend https://unipars.com.ua --backend https://api.unipars.com.ua

Код виходу 0 — усе гаразд, 1 — є проблеми (підходить для CI та моніторингу).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_FRONTEND = "https://unipars-frontend-production.up.railway.app"
DEFAULT_BACKEND = "https://unipars-backend-production.up.railway.app"
EXPECTED_TABLES = ["faculties", "programs", "study_groups", "subjects", "topics", "news_sources",
                   "follows", "dm_conversations", "dm_messages"]


def fetch(url: str, method: str = "GET", headers: dict | None = None, timeout: int = 30):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": "UniPars-Smoke/1.0", **(headers or {})})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), time.monotonic() - started
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), time.monotonic() - started


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frontend", default=DEFAULT_FRONTEND)
    ap.add_argument("--backend", default=DEFAULT_BACKEND)
    a = ap.parse_args()
    fe, be = a.frontend.rstrip("/"), a.backend.rstrip("/")
    results: list[tuple[bool, str]] = []

    def check(ok: bool, msg: str) -> None:
        results.append((ok, msg))
        print(("  OK  " if ok else " FAIL ") + msg)

    print(f"Frontend: {fe}\nBackend:  {be}\n")

    # 1. Backend живий і бачить базу, Auth і всі міграції
    st, _, body, dt = fetch(f"{be}/api/health?deep=1")
    health = json.loads(body) if st == 200 else {}
    check(st == 200 and health.get("ok") is True, f"health deep: HTTP {st}, ok={health.get('ok')} ({dt:.2f}s)")
    check(health.get("mode") == "supabase", f"режим: {health.get('mode')}")
    check(health.get("database") == "ok", f"база даних: {health.get('database')}")
    check(health.get("auth_jwks") == "ok", f"Supabase Auth (JWKS): {health.get('auth_jwks')}")
    schema = health.get("schema", {})
    missing = [t for t in EXPECTED_TABLES if not isinstance(schema.get(t), int)]
    check(not missing, "міграції застосовані" + (f" — бракує: {', '.join(missing)}" if missing else f" ({schema})"))
    # Швидкість: простий health не ходить у базу — показує мережеву затримку до backend
    times = [fetch(f"{be}/api/health")[3] for _ in range(3)]
    check(min(times) < 1.0, f"затримка backend < 1 с (найкраща з 3: {min(times):.2f}s)")
    print(f"  info  deep health (9 запитів до бази + Auth): {dt:.2f}s")

    # 2. Захищені маршрути вимагають вхід
    for path in ("/api/me", "/api/posts", "/api/messages", "/api/users/me"):
        st, *_ = fetch(f"{be}{path}")
        check(st == 401, f"{path} без токена → 401 (отримано {st})")

    # 3. CORS: сайт має право звертатися до API
    st, h, *_ = fetch(f"{be}/api/config", "OPTIONS", {"Origin": fe, "Access-Control-Request-Method": "GET"})
    allow = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin")
    check(st == 200 and allow == fe, f"CORS для {fe}: HTTP {st}, allow-origin={allow}")
    st, h, *_ = fetch(f"{be}/api/config", "OPTIONS", {"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    allow = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin")
    check(allow != "https://evil.example", "CORS не пускає сторонні сайти")

    # 4. Frontend віддає застосунок і вказує на правильний backend
    st, _, html, dt = fetch(f"{fe}/")
    page = html.decode("utf-8", "replace")
    check(st == 200 and "UniPars" in page, f"головна сторінка: HTTP {st} ({dt:.2f}s)")
    st, *_ = fetch(f"{fe}/subjects/some-slug")
    check(st == 200, f"пряме посилання на внутрішню сторінку (SPA fallback): HTTP {st}")
    js = re.search(r'src="(/assets/index-[^"]+\.js)"', page)
    if js:
        st, _, bundle, _ = fetch(fe + js.group(1))
        text = bundle.decode("utf-8", "replace")
        check(be in text or be.replace("https://", "") in text, "збірка frontend звертається до правильного backend")
        check("xxxx.supabase.co" not in text and "твоя-адреса" not in text, "у збірці немає шаблонних значень з інструкції")
    else:
        check(False, "не знайдено JS-бандл на головній сторінці")

    failed = [m for ok, m in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} перевірок пройдено")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
