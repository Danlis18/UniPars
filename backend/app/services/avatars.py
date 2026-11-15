"""Аватар профілю: перевірка, обрізання до квадрата, стиснення у WebP 512×512.

Зображення завжди перекодовується на сервері — так прибираються EXIF (геолокація
тощо) і будь-який «зайвий» вміст файлу.
"""
from __future__ import annotations

import io
import uuid

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.repositories.store import Row, Store

MAX_AVATAR_BYTES = 8 * 1024 * 1024  # вхідний файл
SIZE = 512
Image.MAX_IMAGE_PIXELS = 40_000_000  # захист від «бомб» розпакування


def process_avatar(data: bytes) -> bytes:
    if not data:
        raise HTTPException(400, "Файл порожній")
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "Фото завелике. Максимум 8 МБ")
    try:
        im = Image.open(io.BytesIO(data))
        im.verify()
        im = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise HTTPException(415, "Це не зображення. Підходять JPG, PNG, WEBP або HEIC-фото, збережене як JPG") from e
    if im.format not in ("JPEG", "PNG", "WEBP", "GIF"):
        raise HTTPException(415, "Підтримуються JPG, PNG, WEBP або GIF")
    im = ImageOps.exif_transpose(im).convert("RGB")
    im = ImageOps.fit(im, (SIZE, SIZE), Image.LANCZOS, centering=(0.5, 0.4))
    out = io.BytesIO()
    im.save(out, "WEBP", quality=84, method=6)
    return out.getvalue()


def set_avatar(store: Store, user_id: str, data: bytes, storage) -> Row:
    webp = process_avatar(data)
    old = (store.get("profiles", id=user_id) or {}).get("avatar_url")
    url = storage.put_public(f"{user_id}/{uuid.uuid4().hex}.webp", webp, "image/webp")
    store.update("profiles", {"id": user_id}, {"avatar_url": url})
    if old:
        try:
            storage.remove_public(old)
        except Exception:
            pass  # старий файл не критичний
    return {"avatar_url": url}


def remove_avatar(store: Store, user_id: str, storage) -> Row:
    old = (store.get("profiles", id=user_id) or {}).get("avatar_url")
    store.update("profiles", {"id": user_id}, {"avatar_url": None})
    if old:
        try:
            storage.remove_public(old)
        except Exception:
            pass
    return {"avatar_url": None}
