"""Налаштування оплати на monobank «Банку» (PAYMENT_PROVIDER=jar).

Токен — лише зі змінної оточення, нікуди не друкується:
  PowerShell:  $env:MONOBANK_PERSONAL_TOKEN = "<токен з api.monobank.ua>"
  bash:        export MONOBANK_PERSONAL_TOKEN=<токен>

  python scripts/mono_jar_setup.py jars
      — показує ваші Банки: id (→ MONO_JAR_ID), назву, баланс
  python scripts/mono_jar_setup.py webhook https://unipars-backend-production.up.railway.app <MONO_WEBHOOK_SECRET>
      — вмикає webhook: monobank повідомлятиме backend про нові операції

monobank дозволяє ці запити не частіше 1 разу на 60 секунд.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.integrations.payments.mono_personal import MonoPersonal  # noqa: E402


def main() -> int:
    token = os.environ.get("MONOBANK_PERSONAL_TOKEN", "").strip()
    if not token or len(sys.argv) < 2:
        print(__doc__)
        return 1
    mono = MonoPersonal(token)
    if sys.argv[1] == "jars":
        jars = mono.client_info().get("jars") or []
        if not jars:
            print("Банок не знайдено. Створіть Банку в застосунку monobank і спробуйте за хвилину.")
            return 1
        for j in jars:
            print(f"MONO_JAR_ID={j['id']}   «{j.get('title', '')}»   баланс {j.get('balance', 0) / 100:.2f} ₴   sendId={j.get('sendId', '')}")
        print("\nMONO_JAR_URL — посилання з застосунку: Банка → «Поділитися» (вигляд https://send.monobank.ua/jar/…)")
        return 0
    if sys.argv[1] == "webhook" and len(sys.argv) == 4:
        base, secret = sys.argv[2].rstrip("/"), sys.argv[3]
        if len(secret) < 16:
            print("MONO_WEBHOOK_SECRET має бути щонайменше 16 символів (той самий, що в Railway).")
            return 1
        mono.set_webhook(f"{base}/api/billing/mono-jar/webhook/{secret}")
        print("Webhook увімкнено. Перевірка: зробіть тестовий переказ на Банку — він з'явиться в Керування → Оплати.")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
