import os
import sys
from pathlib import Path

os.environ["APP_MODE"] = "demo"
os.environ["ANTHROPIC_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories.demo_seed import UNI_A, UNI_B, did
from app.repositories.demo_store import reset_demo_store

OLENA, MAKSYM, IRYNA, ANDRII, SOFIIA = (did(f"user:{n}") for n in ("olena", "maksym", "iryna", "andrii", "sofiia"))


@pytest.fixture(autouse=True)
def fresh_store():
    return reset_demo_store()


@pytest.fixture
def client():
    return TestClient(app)


def as_user(user_id: str, uni: str | None = None) -> dict:
    h = {"Authorization": f"Bearer demo:{user_id}"}
    if uni:
        h["X-University-Id"] = uni
    return h


__all__ = ["UNI_A", "UNI_B", "OLENA", "MAKSYM", "IRYNA", "ANDRII", "SOFIIA", "as_user", "did"]
