"""Сховище файлів: приватний бакет Supabase або локальна папка (демо).

Посилання на завантаження видаються лише після перевірки доступу в сервісі
і діють обмежений час.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from pathlib import Path
from typing import Protocol

LINK_TTL_SECONDS = 120


class Storage(Protocol):
    def put(self, path: str, data: bytes, content_type: str) -> None: ...
    def signed_url(self, path: str, file_name: str) -> str: ...
    def remove(self, path: str) -> None: ...


class LocalStorage:
    """Демо: файли в backend/.demo_uploads, тимчасові посилання з HMAC-підписом."""

    def __init__(self, root: Path, secret: str) -> None:
        self.root = root
        self.secret = secret.encode()
        self.root.mkdir(parents=True, exist_ok=True)

    def _file(self, path: str) -> Path:
        p = (self.root / path).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("invalid path")
        return p

    def put(self, path, data, content_type):
        f = self._file(path)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)

    def remove(self, path):
        self._file(path).unlink(missing_ok=True)

    def _sign(self, payload: str) -> str:
        return hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()[:32]

    def signed_url(self, path, file_name):
        exp = int(time.time()) + LINK_TTL_SECONDS
        token = base64.urlsafe_b64encode(f"{path}|{exp}".encode()).decode()
        return f"/api/files/{token}?sig={self._sign(token)}"

    def resolve_token(self, token: str, sig: str) -> Path | None:
        if not hmac.compare_digest(self._sign(token), sig):
            return None
        try:
            path, exp = base64.urlsafe_b64decode(token.encode()).decode().rsplit("|", 1)
        except Exception:
            return None
        if int(exp) < time.time():
            return None
        f = self._file(path)
        return f if f.exists() else None


class SupabaseStorage:
    def __init__(self, client, bucket: str) -> None:
        self.bucket = client.storage.from_(bucket)

    def put(self, path, data, content_type):
        self.bucket.upload(path, data, {"content-type": content_type, "upsert": "false"})

    def remove(self, path):
        self.bucket.remove([path])

    def signed_url(self, path, file_name):
        res = self.bucket.create_signed_url(path, LINK_TTL_SECONDS, {"download": file_name})
        return res.get("signedURL") or res.get("signedUrl")
