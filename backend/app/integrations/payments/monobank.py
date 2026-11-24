"""monobank інтернет-еквайринг: рахунок → сторінка оплати → webhook зі статусом.

Документація: https://api.monobank.ua/docs/acquiring.html
- POST /api/merchant/invoice/create   (X-Token) → {invoiceId, pageUrl}
- GET  /api/merchant/invoice/status   (X-Token) → {status, ...}
- GET  /api/merchant/pubkey           (X-Token) → {key: base64(PEM)} — для перевірки X-Sign у webhook
- POST /api/merchant/invoice/cancel   (X-Token) → {status: processing|success|failure} — повернення коштів
  (повне або часткове; extRef — наш id повернення, за ним шукаємо результат у cancelList статусу рахунку)
Суми — у копійках, валюта 980 (UAH).
"""
from __future__ import annotations

import base64
import time

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

API = "https://api.monobank.ua"
# Статуси monobank → наші
STATUS = {"created": "created", "processing": "processing", "hold": "processing", "success": "success",
          "failure": "failure", "reversed": "failure", "expired": "expired"}


class MonobankError(Exception):
    pass


class MonobankRejected(MonobankError):
    """Банк точно відхилив запит (4xx) — повторювати без змін марно."""


class Monobank:
    def __init__(self, token: str) -> None:
        if not token:
            raise MonobankError("MONOBANK_TOKEN не задано")
        self.token = token
        self._pubkey = None
        self._pubkey_at = 0.0

    def _headers(self) -> dict:
        return {"X-Token": self.token}

    def create_invoice(self, *, amount_kop: int, reference: str, destination: str, redirect_url: str,
                       webhook_url: str | None) -> dict:
        body = {"amount": amount_kop, "ccy": 980, "validity": 3600, "redirectUrl": redirect_url,
                "merchantPaymInfo": {"reference": reference, "destination": destination[:280]}}
        if webhook_url:
            body["webHookUrl"] = webhook_url
        r = httpx.post(f"{API}/api/merchant/invoice/create", json=body, headers=self._headers(), timeout=20)
        if r.status_code != 200:
            raise MonobankError(f"monobank: {r.status_code} {r.text[:200]}")
        data = r.json()
        return {"invoice_id": data["invoiceId"], "page_url": data["pageUrl"]}

    def invoice_status(self, invoice_id: str) -> str:
        r = httpx.get(f"{API}/api/merchant/invoice/status", params={"invoiceId": invoice_id}, headers=self._headers(), timeout=20)
        if r.status_code != 200:
            raise MonobankError(f"monobank: {r.status_code} {r.text[:200]}")
        return STATUS.get(r.json().get("status", ""), "processing")

    def cancel_invoice(self, *, invoice_id: str, amount_kop: int, ext_ref: str) -> str:
        """Повернення коштів за оплачений рахунок. Повертає processing | success | failure.
        4xx — банк відмовив (MonobankRejected); мережеві збої й 5xx — MonobankError (результат невідомий)."""
        body = {"invoiceId": invoice_id, "extRef": ext_ref, "amount": amount_kop}
        r = httpx.post(f"{API}/api/merchant/invoice/cancel", json=body, headers=self._headers(), timeout=20)
        if 400 <= r.status_code < 500:
            raise MonobankRejected(f"monobank: {r.status_code} {r.text[:200]}")
        if r.status_code != 200:
            raise MonobankError(f"monobank: {r.status_code} {r.text[:200]}")
        return r.json().get("status", "processing")

    def cancel_status(self, invoice_id: str, ext_ref: str) -> str | None:
        """Статус повернення з cancelList рахунку; None — банк ще не знає про таке повернення."""
        r = httpx.get(f"{API}/api/merchant/invoice/status", params={"invoiceId": invoice_id}, headers=self._headers(), timeout=20)
        if r.status_code != 200:
            raise MonobankError(f"monobank: {r.status_code} {r.text[:200]}")
        for c in r.json().get("cancelList") or []:
            if c.get("extRef") == ext_ref:
                return c.get("status", "processing")
        return None

    def _public_key(self, refresh: bool = False):
        # ключ змінюється рідко — кешуємо на добу, при невдалій перевірці пробуємо оновити
        if self._pubkey is None or refresh or time.time() - self._pubkey_at > 86400:
            r = httpx.get(f"{API}/api/merchant/pubkey", headers=self._headers(), timeout=20)
            r.raise_for_status()
            self._pubkey = serialization.load_pem_public_key(base64.b64decode(r.json()["key"]))
            self._pubkey_at = time.time()
        return self._pubkey

    def verify(self, body: bytes, x_sign: str) -> bool:
        try:
            sig = base64.b64decode(x_sign)
        except Exception:
            return False
        for refresh in (False, True):
            try:
                self._public_key(refresh).verify(sig, body, ec.ECDSA(hashes.SHA256()))
                return True
            except InvalidSignature:
                continue
        return False
