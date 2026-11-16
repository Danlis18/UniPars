"""Тестове середовище для запису демовідео UniPars: створення й очищення демоданих.

  python scripts/demo_env.py up     # демо-backend (8020) + збірка frontend (5190) з даними DEMO_SEED=showcase
  python scripts/demo_env.py down   # зупиняє сервери й видаляє всі демофайли
  python scripts/demo_env.py check  # перевіряє, що демоданих не лишилось

Працює лише в демо-режимі: дані — у пам'яті локального процесу, файли — у backend/.demo_uploads.
Supabase не використовується: backend запускається з APP_MODE=demo, а скрипт перевіряє це через /api/health.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "backend" / ".demo_uploads" / "showcase_env.json"
UPLOADS = ROOT / "backend" / ".demo_uploads"
BACKEND_PORT, FRONTEND_PORT = 8020, 5190
PY = ROOT / "backend" / (".venv/Scripts/python.exe" if os.name == "nt" else ".venv/bin/python")


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as r:  # noqa: S310 — лише localhost
        return json.loads(r.read().decode())


def wait(url: str, seconds: int = 90) -> None:
    for _ in range(seconds * 2):
        try:
            urllib.request.urlopen(url, timeout=2)  # noqa: S310
            return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"Не дочекався {url}")


def up() -> None:
    if STATE.exists():
        raise SystemExit("Середовище вже запущене (python scripts/demo_env.py down)")
    UPLOADS.mkdir(parents=True, exist_ok=True)
    assets = UPLOADS / "showcase_assets"
    if not (assets / "report-net9.pdf").exists():
        subprocess.run(["node", "scripts/demo-video/make_assets.mjs", str(assets)], cwd=ROOT / "frontend", check=True, shell=os.name == "nt")
    env = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE")}
    env.update({"APP_MODE": "demo", "DEMO_SEED": "showcase", "BOTS_COUNT": "0", "SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": "",
                "SUPABASE_ANON_KEY": "", "CORS_ORIGINS": f"http://localhost:{FRONTEND_PORT}", "PYTHONUTF8": "1"})
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    log = open(UPLOADS / "showcase_backend.log", "w", encoding="utf-8")  # noqa: SIM115
    be = subprocess.Popen([str(PY), "-m", "uvicorn", "app.main:app", "--port", str(BACKEND_PORT)], cwd=ROOT / "backend",
                          env=env, stdout=log, stderr=log, creationflags=flags)
    wait(f"http://127.0.0.1:{BACKEND_PORT}/api/health")
    health = get(f"http://127.0.0.1:{BACKEND_PORT}/api/health?deep=1")
    if health.get("mode") != "demo":
        be.terminate()
        raise SystemExit("Backend не в демо-режимі — зупинено, щоб не торкатися справжніх даних")
    fenv = {**os.environ, "API_PROXY_TARGET": f"http://127.0.0.1:{BACKEND_PORT}", "VITE_SUPABASE_URL": "", "VITE_SUPABASE_ANON_KEY": ""}
    subprocess.run("npx vite build", cwd=ROOT / "frontend", env=fenv, check=True, shell=True, stdout=subprocess.DEVNULL)
    flog = open(UPLOADS / "showcase_frontend.log", "w", encoding="utf-8")  # noqa: SIM115
    fe = subprocess.Popen(f"npx vite preview --port {FRONTEND_PORT} --strictPort", cwd=ROOT / "frontend", env=fenv,
                          stdout=flog, stderr=flog, shell=True, creationflags=flags)
    wait(f"http://localhost:{FRONTEND_PORT}/")
    STATE.write_text(json.dumps({"backend": be.pid, "frontend": fe.pid}), encoding="utf-8")
    users = get(f"http://127.0.0.1:{BACKEND_PORT}/api/demo/users")
    print(f"Готово: http://localhost:{FRONTEND_PORT} · демо-режим · профілі: {', '.join(u['display_name'] for u in users)}")


def kill(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def down() -> None:
    if STATE.exists():
        for pid in json.loads(STATE.read_text(encoding="utf-8")).values():
            kill(pid)
        STATE.unlink()
    time.sleep(1)
    from_seed = None
    sys.path.insert(0, str(ROOT / "backend"))
    from app.repositories.showcase_seed import UNI  # noqa: E402
    from_seed = UPLOADS / UNI
    for p in (from_seed, UPLOADS / "showcase_assets", UPLOADS / "showcase_backend.log", UPLOADS / "showcase_frontend.log"):
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            p.unlink()
    check()


def check() -> None:
    sys.path.insert(0, str(ROOT / "backend"))
    from app.repositories.showcase_seed import UNI  # noqa: E402
    left = [p for p in (UPLOADS / UNI, UPLOADS / "showcase_assets", STATE) if p.exists()]
    running = []
    for port in (BACKEND_PORT, FRONTEND_PORT):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1)  # noqa: S310
            running.append(port)
        except Exception:
            pass
    if left or running:
        raise SystemExit(f"Залишки демоданих: файли {left}, порти {running}")
    print("Демодані прибрано: серверів на 8020/5190 немає, демофайлів немає.")


if __name__ == "__main__":
    {"up": up, "down": down, "check": check}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: print(__doc__))()
