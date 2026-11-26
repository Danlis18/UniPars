"""Оплата на monobank «Банку» з кодом у коментарі: зарахування за випискою, webhook, ручне зіставлення, повернення.
monobank підмінено: FakeMono віддає виписку, яку задає тест."""
import dataclasses
import time

import pytest

from conftest import OLENA, as_user, did

from app.core import config
from app.services import billing, jar

TARAS = did("user:taras")  # адміністратор платформи в демо
SECRET = "s3cret-webhook-path-123456"


class FakeMono:
    def __init__(self):
        self.items, self.calls = [], 0

    def statement(self, account, from_ts, to_ts):
        self.calls += 1
        return list(self.items)

    def add(self, amount_kop, comment, tid=None):
        self.items.append({"id": tid or f"tx{len(self.items) + 1}", "time": int(time.time()), "amount": amount_kop,
                           "comment": comment, "counterName": "Олена К."})


@pytest.fixture
def mono(monkeypatch):
    st = dataclasses.replace(config.get_settings(), app_mode="supabase", payment_provider="jar",
                             mono_personal_token="tok", mono_jar_id="jar-1", mono_jar_url="https://send.monobank.ua/jar/AbC123",
                             mono_webhook_secret=SECRET, legal_name="Данило Л.", support_email="support@example.com")
    for mod in (config, billing, jar):
        monkeypatch.setattr(mod, "get_settings", lambda: st)
    fake = FakeMono()
    monkeypatch.setattr(jar, "_client", lambda: fake)
    monkeypatch.setattr(jar, "_last_fetch", 0.0)
    return fake


def checkout(client, kind="single", quantity=1):
    r = client.post("/api/billing/checkout", headers=as_user(OLENA), json={"kind": kind, "quantity": quantity})
    assert r.status_code == 201, r.text
    return r.json()


def test_checkout_gives_code_and_prefilled_jar_link(client, mono):
    b = client.get("/api/billing", headers=as_user(OLENA)).json()
    assert b["payments_available"] is True
    p = checkout(client)
    assert p["page_url"] == f"/billing/pay/{p['id']}" and p["status"] == "created"
    assert p["code"].startswith("UP-") and len(p["code"]) == 8
    assert p["jar_url"] == f"https://send.monobank.ua/jar/AbC123?a=47&t={p['code']}"


def test_transfer_with_code_credits_once(client, mono, monkeypatch):
    p = checkout(client, "single", 2)
    # студент набрав код кириличною розкладкою й малими літерами
    mono.add(9400, "за звіт " + p["code"].lower().replace("a", "а").replace("p", "р"))
    assert client.get(f"/api/billing/payments/{p['id']}", headers=as_user(OLENA)).json()["status"] == "success"
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 2
    monkeypatch.setattr(jar, "_last_fetch", 0.0)
    jar.sync(__import__("app.core.deps", fromlist=["get_store"]).get_store())  # повторне читання виписки
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 2


def test_statement_read_at_most_once_a_minute(client, mono):
    p = checkout(client)
    for _ in range(5):  # сторінка оплати опитує статус кожні 2 с
        client.get(f"/api/billing/payments/{p['id']}", headers=as_user(OLENA))
    assert mono.calls == 1


def test_webhook_needs_secret_and_never_trusts_its_body(client, mono):
    p = checkout(client)
    assert client.get("/api/billing/mono-jar/webhook/wrong").status_code == 404
    assert client.get(f"/api/billing/mono-jar/webhook/{SECRET}").status_code == 200
    fake = {"type": "StatementItem", "data": {"account": "jar-1", "statementItem": {"id": "x", "amount": 4700, "comment": p["code"]}}}
    assert client.post("/api/billing/mono-jar/webhook/wrong", json=fake).status_code == 404
    assert client.post(f"/api/billing/mono-jar/webhook/{SECRET}", json=fake).status_code == 200
    # у справжній виписці такої операції немає — нічого не зараховано
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 0
    mono.add(4700, p["code"])
    jar._last_fetch = 0.0
    assert client.post(f"/api/billing/mono-jar/webhook/{SECRET}", json={}).status_code == 200
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 1


def test_underpaid_or_codeless_transfer_waits_for_admin(client, mono):
    p = checkout(client)
    mono.add(4000, p["code"], tid="short")
    mono.add(4700, "дякую!", tid="nocode")
    client.get(f"/api/billing/payments/{p['id']}", headers=as_user(OLENA))
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 0
    assert client.get("/api/admin/jar-transfers", headers=as_user(OLENA)).status_code == 403
    pending = {t["id"] for t in client.get("/api/admin/jar-transfers", headers=as_user(TARAS)).json()}
    assert pending == {"short", "nocode"}
    r = client.post("/api/admin/jar-transfers/nocode/match", headers=as_user(TARAS), json={"payment_id": p["id"]})
    assert r.status_code == 200 and r.json()["payment_id"] == p["id"] and r.json()["matched_by"] == TARAS
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 1
    again = client.post("/api/admin/jar-transfers/short/match", headers=as_user(TARAS), json={"payment_id": p["id"]})
    assert again.status_code == 409  # платіж уже оплачено


def test_jar_refund_is_completed_manually(client, mono):
    p = checkout(client, "single", 2)
    mono.add(9400, p["code"])
    client.get(f"/api/billing/payments/{p['id']}", headers=as_user(OLENA))
    r = client.post(f"/api/admin/payments/{p['id']}/refunds", headers=as_user(TARAS), json={"generations": 2, "reason": "запит"}).json()
    assert r["status"] == "pending"  # гроші адміністратор повертає переказом
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["credits"] == 0
    done = client.post(f"/api/admin/refunds/{r['id']}/complete", headers=as_user(TARAS), json={"success": True}).json()
    assert done["status"] == "success"


def test_jar_not_configured_means_no_payments(client, monkeypatch):
    st = dataclasses.replace(config.get_settings(), app_mode="supabase", payment_provider="jar")
    for mod in (config, billing, jar):
        monkeypatch.setattr(mod, "get_settings", lambda: st)
    assert client.get("/api/billing", headers=as_user(OLENA)).json()["payments_available"] is False
    assert client.post("/api/billing/checkout", headers=as_user(OLENA), json={"kind": "single"}).status_code == 503


@pytest.mark.parametrize("comment,code", [("UP-7K3QX", "UP-7K3QX"), ("up 7k3qx дякую", "UP-7K3QX"),
                                          ("оплата UР-7К3QХ", "UP-7K3QX"), ("без коду", None)])
def test_code_recognition(comment, code):
    assert jar.find_code(comment) == code
