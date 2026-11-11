from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends

from app.core.auth import CurrentUser, current_user
from app.core.deps import get_store
from app.repositories.store import Store
from app.services.access import Access


@dataclass
class Ctx:
    user: CurrentUser
    store: Store
    access: Access


def ctx(user: CurrentUser = Depends(current_user)) -> Ctx:
    store = get_store()
    return Ctx(user=user, store=store, access=Access(store, user.id))
