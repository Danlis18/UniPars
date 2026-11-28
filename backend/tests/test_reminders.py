"""Нагадування про кінець підписки за 3 дні (сповіщення + Web Push) і підписка браузера на push."""
import dataclasses
from datetime import datetime, timedelta, timezone

import pytest

from conftest import MAKSYM, OLENA, as_user

from app.core import config
from app.core.deps import get_store
from app.services import push

CRON = "cron-secret-1234567890"
FCM = "https://fcm.googleapis.com/fcm/send/abc123"


@pytest.fixture
def settings(monkeypatch):
    st = dataclasses.replace(config.get_settings(), cron_secret=CRON, vapid_public_key="pub", vapid_private_key="priv")
    for mod in (config, push):
        monkeypatch.setattr(mod, "get_settings", lambda: st)
    import app.api.core as core_api

    monkeypatch.setattr(core_api, "get_settings", lambda: st)
    return st


@pytest.fixture
def sent(monkeypatch):
    calls = []

    def fake(sub, payload):
        calls.append((sub["endpoint"], payload))
        return 410 if "gone" in sub["endpoint"] else 201

    monkeypatch.setattr(push, "_send_one", fake)
    return calls


def subscribe_month(client, user):
    p = client.post("/api/billing/checkout", headers=as_user(user), json={"kind": "subscription"}).json()
    client.post(f"/api/billing/mock/{p['id']}", headers=as_user(user), json={"success": True})
    return get_store().select("subscriptions", [("user_id", "eq", user)])[0]


def ends_in(sub, days):
    get_store().update("subscriptions", {"id": sub["id"]},
                       {"period_end": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()})


def run(client, secret=CRON):
    return client.post("/api/internal/subscription-reminders", headers={"X-Cron-Secret": secret})


def notes(client, user):
    return [n for n in client.get("/api/notifications", headers=as_user(user)).json()["items"] if n["kind"] == "subscription_ending"]


def test_reminder_needs_cron_secret(client, settings):
    assert run(client, "wrong").status_code == 404
    assert client.post("/api/internal/subscription-reminders").status_code == 404


def test_remind_once_three_days_before_end_with_push(client, settings, sent):
    sub = subscribe_month(client, OLENA)
    assert client.post("/api/push/subscriptions", headers=as_user(OLENA),
                       json={"endpoint": FCM, "keys": {"p256dh": "k", "auth": "a"}}).status_code == 200
    assert run(client).json() == {"reminded": 0, "pushed": 0}  # до кінця ще 30 днів
    ends_in(sub, 2)
    assert run(client).json() == {"reminded": 1, "pushed": 1}
    n = notes(client, OLENA)
    assert len(n) == 1 and n[0]["link"] == "/billing" and "Лишилось 15 з 15" in n[0]["body"]
    assert sent[0][0] == FCM and "закінчується" in sent[0][1]
    assert run(client).json() == {"reminded": 0, "pushed": 0}  # той самий період — вдруге не нагадуємо
    assert len(notes(client, OLENA)) == 1


def test_renewal_resets_reminder(client, settings, sent):
    sub = subscribe_month(client, OLENA)
    ends_in(sub, 1)
    run(client)
    subscribe_month(client, OLENA)  # продовження: +30 днів
    assert run(client).json()["reminded"] == 0
    ends_in(get_store().get("subscriptions", id=sub["id"]), 2)  # минув місяць — знову скоро кінець
    assert run(client).json()["reminded"] == 1
    assert len(notes(client, OLENA)) == 2


def test_canceled_or_other_users_not_reminded(client, settings, sent):
    sub = subscribe_month(client, MAKSYM)
    ends_in(sub, 2)
    get_store().update("subscriptions", {"id": sub["id"]}, {"canceled_at": datetime.now(timezone.utc).isoformat()})
    assert run(client).json()["reminded"] == 0
    assert notes(client, OLENA) == [] and notes(client, MAKSYM) == []


def test_dead_browser_subscription_removed(client, settings, sent):
    sub = subscribe_month(client, OLENA)
    client.post("/api/push/subscriptions", headers=as_user(OLENA), json={"endpoint": FCM + "-gone", "keys": {"p256dh": "k", "auth": "a"}})
    ends_in(sub, 2)
    assert run(client).json() == {"reminded": 1, "pushed": 0}
    assert get_store().select("push_subscriptions", [("user_id", "eq", OLENA)]) == []
    assert len(notes(client, OLENA)) == 1  # сповіщення в UniPars лишається


def test_push_subscription_validation(client, settings):
    bad = client.post("/api/push/subscriptions", headers=as_user(OLENA),
                      json={"endpoint": "https://evil.example/collect", "keys": {"p256dh": "k", "auth": "a"}})
    assert bad.status_code == 400  # лише push-сервіси браузерів
    assert client.post("/api/push/subscriptions", headers=as_user(OLENA), json={"endpoint": FCM, "keys": {}}).status_code == 400
    ok = client.post("/api/push/subscriptions", headers=as_user(OLENA), json={"endpoint": FCM, "keys": {"p256dh": "k", "auth": "a"}})
    assert ok.status_code == 200
    # той самий браузер у іншому акаунті — підписка переходить, а не дублюється
    client.post("/api/push/subscriptions", headers=as_user(MAKSYM), json={"endpoint": FCM, "keys": {"p256dh": "k2", "auth": "a2"}})
    rows = get_store().select("push_subscriptions", [("endpoint", "eq", FCM)])
    assert len(rows) == 1 and rows[0]["user_id"] == MAKSYM
    client.post("/api/push/unsubscribe", headers=as_user(MAKSYM), json={"endpoint": FCM})
    assert get_store().select("push_subscriptions", [("endpoint", "eq", FCM)]) == []


def test_push_disabled_without_keys(client, monkeypatch):
    st = dataclasses.replace(config.get_settings(), vapid_public_key="", vapid_private_key="")
    monkeypatch.setattr(push, "get_settings", lambda: st)
    r = client.post("/api/push/subscriptions", headers=as_user(OLENA), json={"endpoint": FCM, "keys": {"p256dh": "k", "auth": "a"}})
    assert r.status_code == 503
    assert client.get("/api/config").json()["vapid_public_key"] is None
