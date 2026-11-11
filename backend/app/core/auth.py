"""Автентифікація: перевірка Supabase JWT (або демо-токена в демо-режимі)."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException

from app.core.config import Settings, get_settings
from app.core.deps import get_store


@dataclass
class CurrentUser:
    id: str
    email: str | None = None


@lru_cache
def _jwks_client(url: str, apikey: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True, headers={"apikey": apikey})


def decode_token(token: str, settings: Settings) -> CurrentUser:
    if settings.is_demo:
        if not token.startswith("demo:"):
            raise HTTPException(401, "Невірний демо-токен")
        return CurrentUser(id=token[5:])
    try:
        if settings.supabase_jwt_secret:
            claims = jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        else:
            key = _jwks_client(settings.supabase_url, settings.supabase_service_role_key).get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated")
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Сесія недійсна або завершилась") from e
    return CurrentUser(id=claims["sub"], email=claims.get("email"))


def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Потрібен вхід")
    user = decode_token(authorization[7:].strip(), get_settings())
    store = get_store()
    if not store.get("profiles", id=user.id):
        if get_settings().is_demo:
            raise HTTPException(401, "Невідомий демо-користувач")
        # Профіль створює тригер у БД; підстраховка на випадок гонки.
        store.insert("profiles", {"id": user.id, "display_name": (user.email or "Студент").split("@")[0]})
    return user


def university_header(x_university_id: str | None = Header(default=None)) -> str:
    if not x_university_id:
        raise HTTPException(400, "Не обрано університет")
    return x_university_id


CurrentUserDep = Depends(current_user)
UniversityDep = Depends(university_header)
