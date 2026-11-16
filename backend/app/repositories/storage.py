"""Сховище файлів: приватний бакет Supabase або локальна папка (демо).

Посилання на завантаження видаються лише після перевірки доступу в сервісі
і діють обмежений час.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException

LINK_TTL_SECONDS = 120


log = logging.getLogger("unipars.storage")


class Storage(Protocol):
    def put(self, path: str, data: bytes, content_type: str) -> None: ...
    def signed_url(self, path: str, file_name: str, download: bool = False) -> str: ...
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

    def signed_url(self, path, file_name, download=False):
        # Режим (перегляд у браузері чи завантаження) входить у підпис — підмінити його не можна
        exp = int(time.time()) + LINK_TTL_SECONDS
        mode = "a" if download else "i"
        token = base64.urlsafe_b64encode(f"{path}|{exp}|{mode}|{file_name}".encode()).decode()
        return f"/api/files/{token}?sig={self._sign(token)}"

    # Публічні файли (аватари): backend/.demo_uploads/public/<path>, віддаються через /api/public/<path>
    def put_public(self, path: str, data: bytes, content_type: str) -> str:
        f = self._file(f"public/{path}")
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
        return f"/api/public/{path}"

    def remove_public(self, url: str) -> None:
        if url and url.startswith("/api/public/"):
            self._file("public/" + url[len("/api/public/"):]).unlink(missing_ok=True)

    def public_file(self, path: str) -> Path | None:
        try:
            f = self._file(f"public/{path}")
        except ValueError:
            return None
        return f if f.is_file() else None

    def resolve_token(self, token: str, sig: str) -> tuple[Path, bool, str] | None:
        """Повертає (файл, download, назва для користувача) для дійсного посилання."""
        if not hmac.compare_digest(self._sign(token), sig):
            return None
        try:
            path, exp, mode, name = base64.urlsafe_b64decode(token.encode()).decode().split("|", 3)
        except Exception:
            return None
        if int(exp) < time.time():
            return None
        f = self._file(path)
        return (f, mode == "a", name) if f.exists() else None


class SupabaseStorage:
    def __init__(self, client, bucket: str, supabase_url: str = "", public_bucket: str = "avatars") -> None:
        self.bucket = client.storage.from_(bucket)
        self.public = client.storage.from_(public_bucket)
        self.public_prefix = f"{supabase_url}/storage/v1/object/public/{public_bucket}/"

    def put_public(self, path, data, content_type):
        self.public.upload(path, data, {"content-type": content_type, "upsert": "true", "cache-control": "31536000"})
        return self.public_prefix + path

    def remove_public(self, url):
        if url and url.startswith(self.public_prefix):
            self.public.remove([url[len(self.public_prefix):]])

    def put(self, path, data, content_type):
        try:
            self.bucket.upload(path, data, {"content-type": content_type, "upsert": "false"})
        except Exception as e:  # помилка сховища → зрозуміла відповідь, а не обрив з'єднання
            log.exception("storage upload failed: %s (%d bytes)", path, len(data))
            msg = str(getattr(e, "message", "") or e)[:200]
            raise HTTPException(502, f"Сховище файлів не прийняло файл: {msg}") from e

    def remove(self, path):
        self.bucket.remove([path])

    def signed_url(self, path, file_name, download=False):
        # Без параметра download Supabase віддає файл inline — PDF і зображення відкриваються в браузері
        options = {"download": file_name} if download else {}
        res = self.bucket.create_signed_url(path, LINK_TTL_SECONDS, options)
        return res.get("signedURL") or res.get("signedUrl")
