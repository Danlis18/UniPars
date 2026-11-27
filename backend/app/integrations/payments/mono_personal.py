"""Особистий API monobank: виписка Банки й webhook (без еквайрингу, для фізичної особи).

Документація: https://api.monobank.ua/docs/
- GET  /personal/client-info                    — рахунки й Банки (id, sendId, назва, баланс)
- GET  /personal/statement/{account}/{from}/{to} — виписка (час — unix-секунди, до 31 доби + 1 год)
- POST /personal/webhook {webHookUrl}            — monobank шле POST на кожну операцію
Обмеження monobank: client-info і statement — не частіше 1 разу на 60 секунд.
Webhook не підписаний, тому його тілу не довіряємо: він лише сигнал перечитати виписку.
"""
from __future__ import annotations

import httpx

API = "https://api.monobank.ua"


class MonoPersonalError(Exception):
    pass


class MonoPersonal:
    def __init__(self, token: str) -> None:
        if not token:
            raise MonoPersonalError("MONOBANK_PERSONAL_TOKEN не задано")
        self.token = token

    def _get(self, path: str):
        r = httpx.get(f"{API}{path}", headers={"X-Token": self.token}, timeout=20)
        if r.status_code == 429:
            raise MonoPersonalError("monobank: забагато запитів (не частіше 1 разу на 60 с)")
        if r.status_code != 200:
            raise MonoPersonalError(f"monobank: {r.status_code} {r.text[:200]}")
        return r.json()

    def client_info(self) -> dict:
        return self._get("/personal/client-info")

    def statement(self, account: str, from_ts: int, to_ts: int) -> list[dict]:
        return self._get(f"/personal/statement/{account}/{from_ts}/{to_ts}")

    def set_webhook(self, url: str) -> None:
        r = httpx.post(f"{API}/personal/webhook", json={"webHookUrl": url}, headers={"X-Token": self.token}, timeout=20)
        if r.status_code != 200:
            raise MonoPersonalError(f"monobank: {r.status_code} {r.text[:200]}")
